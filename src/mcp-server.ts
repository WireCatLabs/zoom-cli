import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import type { MeetingStore } from "@wirecat/cli-meetings"
import { callMeetingTool, meetingTools } from "@wirecat/cli-meetings/mcp"
import { ZoomError } from "./errors.js"
import type { StoreConnection } from "./program.js"
import { VERSION } from "./version.js"

export interface MeetingMcpOptions {
  /** Resolve the selected profile with read intent; each call owns a fresh connection. */
  connectStore: () => Promise<StoreConnection>
  version?: string
  signal?: AbortSignal
  /** Maximum UTF-8 bytes in a serialized tool result, including both content forms; zero is unlimited. */
  maxResultBytes?: number
}

const failure = (code: string, message: string) => {
  const result = { error: { code, message } }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: true,
  }
}

/** SDK protocol handling; shared meeting tools own all read behavior and validation. */
const buildServer = (options: MeetingMcpOptions) => {
  const maxResultBytes = options.maxResultBytes ?? 4 * 1024 * 1024
  if (!Number.isSafeInteger(maxResultBytes) || maxResultBytes < 0)
    throw new ZoomError("validation_error", "maxResultBytes must be a nonnegative safe integer")
  const running = new Set<Promise<unknown>>()
  let stopping = false
  const validator = new AjvJsonSchemaValidator()
  const tools = meetingTools.map((tool) => {
    const properties = Object.fromEntries(
      Object.entries(tool.inputSchema.properties).filter(([key]) => key !== "account_id"),
    )
    return { ...tool, inputSchema: { ...tool.inputSchema, type: "object" as const, properties } } satisfies Tool
  })
  const validated = new Map(
    tools.map((tool) => [tool.name, validator.getValidator<Record<string, unknown>>(tool.inputSchema)]),
  )
  const server = new Server(
    { name: "zoom-meetings", version: options.version ?? VERSION },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  const call = async (
    request: { params: { name: string; arguments?: Record<string, unknown> } },
    requestSignal: AbortSignal,
  ) => {
    const signal = options.signal ? AbortSignal.any([options.signal, requestSignal]) : requestSignal
    const cancelled = () => stopping || signal.aborted
    if (cancelled()) return failure("cancelled", "meeting read was cancelled")
    const validate = validated.get(request.params.name)
    if (!validate) return failure("validation_error", "unknown meeting tool")
    const args = request.params.arguments ?? {}
    const prototype = Object.getPrototypeOf(args)
    if ((prototype !== null && prototype !== Object.prototype) || "account_id" in args || !validate(args).valid)
      return failure("validation_error", "invalid meeting tool arguments; account is selected by the server")
    let connection: StoreConnection
    try {
      connection = await options.connectStore()
    } catch {
      return failure("configuration_error", "could not open the selected meeting account")
    }
    let result: Awaited<ReturnType<typeof callMeetingTool>> = failure("generic_failure", "Meeting read failed")
    try {
      if (cancelled()) result = failure("cancelled", "meeting read was cancelled")
      else if (!Number.isSafeInteger(connection.accountId) || connection.accountId < 1)
        result = failure("configuration_error", "the selected meeting account is unavailable")
      else {
        // Ports have no AbortSignal argument. Guard each new read, let an active read settle,
        // and retain its connection until the operation and close finish.
        const store = new Proxy(connection.store, {
          get(target, key) {
            const value = Reflect.get(target, key)
            return typeof value === "function"
              ? (...args: unknown[]) => {
                  if (cancelled()) throw new ZoomError("cancelled", "meeting read was cancelled")
                  return Reflect.apply(value, target, args)
                }
              : value
          },
        }) as MeetingStore
        result = await callMeetingTool(store, request.params.name, {
          ...args,
          account_id: connection.accountId,
        })
      }
    } catch {
      result = failure("generic_failure", "Meeting read failed")
    } finally {
      try {
        await connection.close()
      } catch {
        result = failure("generic_failure", "could not close the meeting read connection")
      }
    }
    if (cancelled()) return failure("cancelled", "meeting read was cancelled")
    return maxResultBytes !== 0 && Buffer.byteLength(JSON.stringify(result), "utf8") > maxResultBytes
      ? failure("validation_error", "meeting tool result exceeds maxResultBytes")
      : result
  }
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    const result = call(request, extra.signal)
    running.add(result)
    void result.then(
      () => running.delete(result),
      () => running.delete(result),
    )
    return result
  })
  return {
    server,
    stop: () => {
      stopping = true
    },
    settled: async () => {
      await Promise.all(running)
    },
  }
}

/** Embedding seam. Caller owns transport shutdown; each tool call closes its read connection. */
export const createMeetingMcpServer = (options: MeetingMcpOptions): Server => buildServer(options).server

/** Serve until EOF, transport close or abort; in-flight reads close before this resolves. */
export const serveMeetingMcp = async (options: MeetingMcpOptions, transport?: Transport): Promise<void> => {
  if (options.signal?.aborted) return
  const { server, stop, settled } = buildServer(options)
  let resolveClosed!: () => void
  let rejectClosed!: (error: unknown) => void
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  // Shutdown can reject while connect is still pending; keep that rejection observed
  // until the connection attempt settles and the original failure can be reported.
  void closed.catch(() => {})
  let closing: Promise<void> | undefined
  let connecting: Promise<void> | undefined
  const close = () => (closing ??= server.close())
  server.onclose = () => {
    stop()
    void settled().then(resolveClosed, rejectClosed)
  }
  const shutdown = () => {
    stop()
    void Promise.resolve(connecting).then(settled).then(close).then(resolveClosed, rejectClosed)
  }
  options.signal?.addEventListener("abort", shutdown, { once: true })
  if (!transport) process.stdin.once("end", shutdown)
  let failed = false
  let earlierError: unknown
  try {
    connecting = server.connect(transport ?? new StdioServerTransport())
    await connecting
    if (options.signal?.aborted) shutdown()
    await closed
  } catch (error) {
    failed = true
    earlierError = error
  } finally {
    options.signal?.removeEventListener("abort", shutdown)
    if (!transport) process.stdin.removeListener("end", shutdown)
    stop()
    try {
      await settled()
      await close()
    } catch (error) {
      if (!failed) {
        failed = true
        earlierError = error
      }
    }
  }
  if (failed) throw earlierError
}
