import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { CliError, type ErrorCode, errorObjectOf, isCliError, mcpErrorResult } from "@wirecat/cli-base"
import {
  agentResult,
  LOCAL_READ,
  meetingProjectCandidatesTool,
  meetingSeriesInventoryTool,
  snakeKeys,
  UNTRUSTED,
  UNTRUSTED_INSTRUCTION,
} from "@wirecat/cli-core/cli"
import { type MeetingStore, SAVE_INSTRUCTION } from "@wirecat/cli-core/meetings"
import {
  callMeetingPassageTool,
  callMeetingSearchTool,
  callMeetingTool,
  meetingPassageTool,
  meetingProjectEvidenceTool,
  meetingSearchTool,
  meetingTools,
} from "@wirecat/cli-core/meetings/mcp"
import type { MeetingSearchCursor } from "@wirecat/cli-core/services"
import { hostFailureContext } from "./answer-policy.js"
import { readMetadata, toolAnswer, toolAnswerSchema } from "./answers.js"
import { camelKeys } from "./keys.js"
import {
  type MeetingTaskKind,
  validateEvidenceOptions,
  validatePersonContext,
  validateTaskKind,
  validateTaskProposal,
} from "./meeting-context.js"
import { readInventoryTool } from "./meeting-inventory-mcp.js"
import type { MeetingMcpOptions } from "./meeting-mcp-options.js"
import { preparationToolFor, readPreparationTool } from "./meeting-preparation-mcp.js"
import { readProjectCandidatesTool } from "./meeting-project-candidates-mcp.js"
import { readProjectEvidenceTool } from "./meeting-project-evidence-mcp.js"
import { validateMeetingModel, validateMeetingSemantic } from "./meeting-semantic-commands.js"
import type { StoreConnection } from "./store-connection.js"
import { runUnifiedSearch, unifiedSearchAnswer } from "./unified-search.js"
import { VERSION } from "./version.js"

export type { MeetingMcpOptions } from "./meeting-mcp-options.js"

const failure = (code: ErrorCode, message: string) =>
  mcpErrorResult(errorObjectOf(new CliError(code, message), hostFailureContext(undefined, LOCAL_READ)))
const crashed = () => mcpErrorResult(errorObjectOf(undefined, hostFailureContext(undefined, LOCAL_READ)))

/** SDK protocol handling; shared meeting tools own all read behavior and validation. */
const buildServer = (options: MeetingMcpOptions) => {
  const context = options.preparation?.context?.()
  const preparation = options.preparation
    ? { ...options.preparation, context: context ? () => context : undefined }
    : undefined
  const semanticModel = options.semanticModel ? Object.freeze({ ...options.semanticModel }) : undefined
  const inventory = options.inventory
  if (inventory !== undefined && typeof inventory !== "function")
    throw new CliError("configuration_error", "meeting inventory must be an explicitly bound reader")
  const maxResultBytes = options.maxResultBytes ?? 4 * 1024 * 1024
  if (!Number.isSafeInteger(maxResultBytes) || maxResultBytes < 0)
    throw new CliError("validation_error", "maxResultBytes must be a nonnegative safe integer")
  const running = new Set<Promise<unknown>>()
  let stopping = false
  const validator = new AjvJsonSchemaValidator()
  const tools: Tool[] = meetingTools.map((tool) => {
    const properties = Object.fromEntries(
      Object.entries(tool.inputSchema.properties).filter(([key]) => key !== "account_id"),
    )
    return { ...tool, inputSchema: { ...tool.inputSchema, type: "object" as const, properties } } satisfies Tool
  })
  if (inventory) tools.push(meetingSeriesInventoryTool)
  if (options.includeMeetingProjectCandidates === true) tools.push(meetingProjectCandidatesTool)
  tools.push(meetingProjectEvidenceTool)
  if (preparation) tools.push(preparationToolFor(context))
  const meaningArguments = {
    by_meaning: { type: "boolean" },
    max_chunks: { type: "integer", minimum: 1, maximum: 10000 },
    max_rows: { type: "integer", minimum: 1, maximum: 100000 },
    max_text_bytes: { type: "integer", minimum: 1, maximum: 67108864 },
  }
  if (semanticModel) {
    validateMeetingModel(semanticModel)
    tools.push({
      ...meetingSearchTool,
      description: meetingSearchTool.description.replace(
        UNTRUSTED,
        `by_meaning ranks stored vectors with the server's model and builds none. ${UNTRUSTED}`,
      ),
      annotations: { ...meetingSearchTool.annotations, openWorldHint: semanticModel.baseUrl !== undefined },
      inputSchema: {
        ...meetingSearchTool.inputSchema,
        properties: { ...meetingSearchTool.inputSchema.properties, ...meaningArguments },
      },
    })
  } else tools.push(meetingSearchTool)
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
            required: ["account_id", "query", "meeting_offset", "hit_offset"],
            properties: {
              account_id: { type: "integer", minimum: 1 },
              query: { type: "string", minLength: 1 },
              meeting_offset: { type: "integer", minimum: 0 },
              hit_offset: { type: "integer", minimum: 0 },
            },
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    })
  if (options.includeMeetingContext) {
    tools.push(meetingPassageTool)
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
        properties: {
          reference: { type: "string", minLength: 1 },
          ...limits,
          after: { type: "string", minLength: 1 },
          after_transcript_id: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
          max_read_bytes: { type: "integer", minimum: 1, maximum: 67108864 },
          max_transcript_pages: { type: "integer", minimum: 1, maximum: 1000 },
        },
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
  // Said on every tool, not only in the instructions: a host may show a model the tool alone.
  for (const [index, tool] of tools.entries())
    tools[index] = {
      ...tool,
      outputSchema: tool.outputSchema ?? toolAnswerSchema,
      description: tool.description?.includes(UNTRUSTED) ? tool.description : `${tool.description}. ${UNTRUSTED}`,
    }
  const validated = new Map(
    tools.map((tool) => [tool.name, validator.getValidator<Record<string, unknown>>(tool.inputSchema)]),
  )
  const server = new Server(
    { name: "zoom-meetings", version: options.version ?? VERSION },
    { capabilities: { tools: {} }, instructions: `${UNTRUSTED_INSTRUCTION}\n${SAVE_INSTRUCTION}` },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  const bounded = <T>(result: T) =>
    maxResultBytes !== 0 && Buffer.byteLength(JSON.stringify(result), "utf8") > maxResultBytes
      ? failure("validation_error", "meeting tool result exceeds maxResultBytes")
      : result
  const call = async (
    request: { params: { name: string; arguments?: Record<string, unknown> } },
    requestSignal: AbortSignal,
  ) => {
    const signal = options.signal ? AbortSignal.any([options.signal, requestSignal]) : requestSignal
    const cancelled = () => stopping || signal.aborted
    if (cancelled()) return failure("cancelled", "meeting read was cancelled")
    const validate = validated.get(request.params.name)
    if (!validate) return failure("validation_error", "unknown meeting tool")
    const meta = readMetadata(options.now)
    const args = request.params.arguments ?? {}
    const tool = tools.find((candidate) => candidate.name === request.params.name)
    const unknown = Object.keys(args).filter((key) => !Object.hasOwn(tool?.inputSchema.properties ?? {}, key))
    if (unknown.length) return failure("validation_error", `unknown meeting tool argument: ${unknown.join(", ")}`)
    const prototype = Object.getPrototypeOf(args)
    if (prototype !== null && prototype !== Object.prototype)
      return failure("validation_error", "meeting tool arguments must be a plain object")
    const checked = validate(args)
    if (!checked.valid) return failure("validation_error", `invalid meeting tool arguments: ${checked.errorMessage}`)
    if (request.params.name === "meeting_series_inventory" && inventory) {
      const result = await readInventoryTool(inventory, args, signal, options)
      return cancelled() ? failure("cancelled", "meeting inventory was cancelled") : result
    }
    if (request.params.name === "meeting_prepare") {
      const result = await readPreparationTool({ ...options, preparation }, args, signal)
      return cancelled() ? failure("cancelled", "meeting read was cancelled") : result
    }
    if (request.params.name === "meeting_project_candidates") {
      const result = await readProjectCandidatesTool(options, args, signal)
      return cancelled() ? failure("cancelled", "meeting read was cancelled") : result
    }
    if (request.params.name === "meeting_project_evidence") {
      const result = await readProjectEvidenceTool(options, args, signal)
      return cancelled() ? failure("cancelled", "meeting read was cancelled") : result
    }
    let connection: StoreConnection
    try {
      connection = await options.connectStore()
    } catch {
      return failure("configuration_error", "could not open the selected meeting account")
    }
    let result: Awaited<ReturnType<typeof callMeetingTool>> = crashed()
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
                  if (cancelled()) throw new CliError("cancelled", "meeting read was cancelled")
                  return Reflect.apply(value, target, args)
                }
              : value
          },
        }) as MeetingStore
        if (request.params.name === "search_meetings" && args.by_meaning === true) {
          if (!semanticModel) throw new CliError("configuration_error", "meeting search by meaning is unavailable")
          const wordsOnly = Object.keys(args).filter(
            (key) => !["query", "limit", "cursor", ...Object.keys(meaningArguments)].includes(key),
          )
          if (wordsOnly.length)
            throw new CliError("validation_error", `${wordsOnly.join(", ")} do not apply to a search by meaning`)
          const cursor = args.cursor as string | undefined
          if (cursor !== undefined && !/^[1-9]\d{0,15}$/.test(cursor))
            throw new CliError("validation_error", "cursor by meaning takes the previous page's next_cursor")
          const request = {
            ...semanticModel,
            limit: args.limit as number | undefined,
            maxChunks: args.max_chunks as number | undefined,
            afterChunkId: cursor === undefined ? undefined : Number(cursor),
            maxRows: args.max_rows as number | undefined,
            maxTextBytes: args.max_text_bytes as number | undefined,
            signal,
          }
          validateMeetingSemantic(args.query as string, request)
          const value = await connection.meetingSemantic.search(args.query as string, request)
          if (typeof value !== "object" || value === null || Array.isArray(value))
            throw new CliError("invalid_response", "meeting search by meaning returned an invalid report")
          const next = (value as { nextChunkId?: number }).nextChunkId
          const found = snakeKeys({ ...value, nextCursor: next === undefined ? null : String(next) }) as Record<
            string,
            unknown
          >
          result = { content: [{ type: "text", text: JSON.stringify(found) }], structuredContent: found }
        } else if (request.params.name === "meeting_passage") {
          result = await callMeetingPassageTool(
            connection.meetingContext.passage,
            args,
            signal,
            hostFailureContext(options.commandRegistry, LOCAL_READ),
          )
        } else if (request.params.name === "search_meetings") {
          const words = Object.fromEntries(
            Object.entries(args).filter(([key]) => !(key === "by_meaning" && args.by_meaning === false)),
          )
          result = await callMeetingSearchTool(
            connection.meetingSearch,
            words,
            signal,
            hostFailureContext(options.commandRegistry, LOCAL_READ),
          )
        } else if (
          ["meeting_evidence", "person_meeting_context", "meeting_task_proposal"].includes(request.params.name)
        ) {
          const context = connection.meetingContext
          let value: unknown
          if (request.params.name === "meeting_evidence") {
            const options = {
              cues: args.cues as number | undefined,
              bytes: args.bytes as number | undefined,
              after: args.after as string | undefined,
              afterTranscriptId: args.after_transcript_id as number | undefined,
              maxReadBytes: args.max_read_bytes as number | undefined,
              maxTranscriptPages: args.max_transcript_pages as number | undefined,
              signal,
            }
            validateEvidenceOptions(options)
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
            value = await context.personContext(args.person as string, options)
          } else {
            validateTaskKind(args.kind as string)
            value = await context.taskProposal(args.reference as string, args.kind as MeetingTaskKind, signal)
            validateTaskProposal(value)
          }
          if (typeof value !== "object" || value === null || Array.isArray(value))
            throw new CliError("invalid_response", "meeting context returned an invalid report")
          const found = snakeKeys(value) as Record<string, unknown>
          result = { content: [{ type: "text", text: JSON.stringify(found) }], structuredContent: found }
        } else if (request.params.name === "search_all") {
          const found = await runUnifiedSearch(
            connection.unifiedSearch,
            {
              text: args.query as string,
              limit: (args.limit as number | undefined) ?? 100,
              maxMeetings: args.max_meetings as number | undefined,
              exact: args.exact as boolean | undefined,
              meetingCursor: camelKeys(args.meeting_cursor) as MeetingSearchCursor | undefined,
              only: ["meetings"],
              signal,
            },
            true,
          )
          const snake = snakeKeys(unifiedSearchAnswer(found)) as Record<string, unknown>
          result = { content: [{ type: "text", text: JSON.stringify(snake) }], structuredContent: snake }
        } else
          result = await callMeetingTool(
            store,
            request.params.name,
            {
              ...args,
              account_id: connection.accountId,
            },
            hostFailureContext(options.commandRegistry, LOCAL_READ),
          )
      }
    } catch (error) {
      result =
        [
          "search_all",
          "search_meetings",
          "meeting_evidence",
          "meeting_passage",
          "person_meeting_context",
          "meeting_task_proposal",
        ].includes(request.params.name) && isCliError(error)
          ? mcpErrorResult(errorObjectOf(error, hostFailureContext(undefined, LOCAL_READ)))
          : crashed()
    } finally {
      try {
        await connection.close()
      } catch {
        result = crashed()
      }
    }
    if (cancelled()) return failure("cancelled", "meeting read was cancelled")
    if (!result.isError) {
      try {
        const answer = toolAnswer(result.structuredContent, meta(), options.commandRegistry)
        result = { content: [{ type: "text", text: JSON.stringify(answer) }], structuredContent: answer }
      } catch (error) {
        result = mcpErrorResult(errorObjectOf(error, hostFailureContext(undefined, LOCAL_READ)))
      }
    }
    return result
  }
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    // Escaping lengthens the answer, so the byte limit counts what the agent reads.
    const result = call(request, extra.signal).then((answer) => bounded(agentResult(answer)))
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
