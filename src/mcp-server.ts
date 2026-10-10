import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { CliError } from "@wirecat/cli-core"
import type { MeetingStore } from "@wirecat/cli-meetings"
import { callMeetingTool, meetingTools } from "@wirecat/cli-meetings/mcp"
import type { MeetingSearchCursor } from "@wirecat/cli-messaging/services"
import { ZoomError } from "./errors.js"
import {
  type MeetingTaskKind,
  validateEvidenceOptions,
  validatePersonContext,
  validateTaskKind,
  validateTaskProposal,
} from "./meeting-context.js"
import { type MeetingModelOptions, validateMeetingModel, validateMeetingSemantic } from "./meeting-semantic-commands.js"
import type { StoreConnection } from "./program.js"
import { runUnifiedSearch } from "./unified-search.js"
import { VERSION } from "./version.js"

export interface MeetingMcpOptions {
  /** Resolve the selected profile with read intent; each call owns a fresh connection. */
  connectStore: () => Promise<StoreConnection>
  version?: string
  signal?: AbortSignal
  /** Maximum UTF-8 bytes in a serialized tool result, including both content forms; zero is unlimited. */
  maxResultBytes?: number
  /** Opt-in selected-profile meetings only; store-global notes are never exposed here. */
  includeUnifiedSearch?: boolean
  includeMeetingContext?: boolean
  /** Explicit server-selected query model; tool callers cannot select models or generate vectors. */
  semanticModel?: MeetingModelOptions
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
  if (options.semanticModel) {
    validateMeetingModel(options.semanticModel)
    tools.push({
      name: "meeting_semantic_search",
      description:
        "Selected-account stored vector search; ranks scanned candidates only, using the server's explicit query model",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 1000 },
          max_chunks: { type: "integer", minimum: 1, maximum: 10000 },
          after_chunk_id: { type: "integer", minimum: 1 },
          max_rows: { type: "integer", minimum: 1, maximum: 100000 },
          max_text_bytes: { type: "integer", minimum: 1, maximum: 67108864 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    })
  }
  if (options.includeUnifiedSearch)
    tools.push({
      name: "search_all",
      description:
        "Selected-profile meeting word-prefix search with explicit completeness and source-only continuation",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 1000 },
          max_meetings: { type: "integer", minimum: 1, maximum: 1000 },
          exact: { type: "boolean" },
          meeting_cursor: {
            type: "object",
            additionalProperties: false,
            required: ["accountId", "query", "meetingOffset", "hitOffset"],
            properties: {
              accountId: { type: "integer", minimum: 1 },
              query: { type: "string", minLength: 1 },
              meetingOffset: { type: "integer", minimum: 0 },
              hitOffset: { type: "integer", minimum: 0 },
            },
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    })
  if (options.includeMeetingContext) {
    const hints = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
    const limits = {
      cues: { type: "integer", minimum: 1, maximum: 1000 },
      bytes: { type: "integer", minimum: 2, maximum: 4194304 },
    }
    tools.push({
      name: "meeting_evidence",
      description: "Stored selected-account meeting evidence; coverage and revision are explicit",
      annotations: hints,
      inputSchema: {
        type: "object",
        properties: { reference: { type: "string", minLength: 1 }, ...limits },
        required: ["reference"],
        additionalProperties: false,
      },
    })
    tools.push({
      name: "person_meeting_context",
      description: "Identity-linked meeting context restricted to the selected profile account",
      annotations: hints,
      inputSchema: {
        type: "object",
        properties: {
          person: { type: "string", pattern: "^person:[1-9][0-9]*$" },
          ...limits,
          meetings: { type: "integer", minimum: 1, maximum: 100 },
          scan_limit: { type: "integer", minimum: 1, maximum: 1000 },
          since: { type: "integer", minimum: -8640000000000000, maximum: 8640000000000000 },
        },
        required: ["person"],
        additionalProperties: false,
      },
    })
    tools.push({
      name: "meeting_task_proposal",
      description: "Preview provenance-linked question/request/mention/promise; never creates a task",
      annotations: hints,
      inputSchema: {
        type: "object",
        properties: {
          reference: { type: "string", minLength: 1 },
          kind: { type: "string", enum: ["question", "request", "mention", "promise"] },
        },
        required: ["reference", "kind"],
        additionalProperties: false,
      },
    })
  }
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
        if (request.params.name === "meeting_semantic_search") {
          if (!options.semanticModel || !connection.meetingSemantic)
            throw new ZoomError("configuration_error", "meeting semantic capability is unavailable")
          const request = {
            ...options.semanticModel,
            limit: args.limit as number | undefined,
            maxChunks: args.max_chunks as number | undefined,
            afterChunkId: args.after_chunk_id as number | undefined,
            maxRows: args.max_rows as number | undefined,
            maxTextBytes: args.max_text_bytes as number | undefined,
            signal,
          }
          validateMeetingSemantic(args.query as string, request)
          const value = await connection.meetingSemantic.search(args.query as string, request)
          if (typeof value !== "object" || value === null || Array.isArray(value))
            throw new ZoomError("invalid_response", "meeting semantic returned an invalid report")
          result = {
            content: [{ type: "text", text: JSON.stringify(value) }],
            structuredContent: value as Record<string, unknown>,
          }
        } else if (
          ["meeting_evidence", "person_meeting_context", "meeting_task_proposal"].includes(request.params.name)
        ) {
          const context = connection.meetingContext
          let value: unknown
          if (request.params.name === "meeting_evidence") {
            const options = { cues: args.cues as number | undefined, bytes: args.bytes as number | undefined, signal }
            validateEvidenceOptions(options)
            if (!context?.evidence)
              throw new ZoomError("configuration_error", "meeting evidence capability is unavailable")
            value = await context.evidence(args.reference as string, options)
          } else if (request.params.name === "person_meeting_context") {
            const options = {
              meetings: args.meetings as number | undefined,
              cues: args.cues as number | undefined,
              bytes: args.bytes as number | undefined,
              scanLimit: args.scan_limit as number | undefined,
              since: args.since as number | undefined,
              signal,
            }
            validatePersonContext(args.person as string, options)
            if (!context?.personContext)
              throw new ZoomError("configuration_error", "person meeting context capability is unavailable")
            value = await context.personContext(args.person as string, options)
          } else {
            validateTaskKind(args.kind as string)
            if (!context?.taskProposal)
              throw new ZoomError("configuration_error", "meeting task proposal capability is unavailable")
            value = await context.taskProposal(args.reference as string, args.kind as MeetingTaskKind, signal)
            validateTaskProposal(value)
          }
          if (typeof value !== "object" || value === null || Array.isArray(value))
            throw new ZoomError("invalid_response", "meeting context returned an invalid report")
          result = {
            content: [{ type: "text", text: JSON.stringify(value) }],
            structuredContent: value as Record<string, unknown>,
          }
        } else if (request.params.name === "search_all") {
          if (!connection.unifiedSearch)
            result = failure("configuration_error", "unified meeting search is unavailable")
          else {
            const found = await runUnifiedSearch(
              connection.unifiedSearch,
              {
                text: args.query as string,
                limit: (args.limit as number | undefined) ?? 100,
                maxMeetings: args.max_meetings as number | undefined,
                exact: args.exact as boolean | undefined,
                meetingCursor: args.meeting_cursor as MeetingSearchCursor | undefined,
                only: ["meetings"],
                signal,
              },
              true,
            )
            result = { content: [{ type: "text", text: JSON.stringify(found) }], structuredContent: found }
          }
        } else
          result = await callMeetingTool(store, request.params.name, {
            ...args,
            account_id: connection.accountId,
          })
      }
    } catch (error) {
      result =
        [
          "search_all",
          "meeting_evidence",
          "person_meeting_context",
          "meeting_task_proposal",
          "meeting_semantic_search",
        ].includes(request.params.name) && error instanceof CliError
          ? failure(error.code, "selected-account meeting operation failed")
          : failure("generic_failure", "Meeting read failed")
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
