import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"
import type { ZoomPreparationOptions } from "./meeting-preparation.js"
import { type MeetingModelOptions, validateMeetingModel } from "./meeting-semantic-commands.js"

export interface ZoomMcpServeOptions {
  signal: AbortSignal
  commandRegistry: Command
  maxResultBytes?: number
  includeUnifiedSearch?: boolean
  includeMeetingContext?: boolean
  semanticModel?: MeetingModelOptions
  preparation?: ZoomPreparationOptions
}
export const addZoomMcpCommand = (
  program: Command,
  deps: {
    fields: () => string[] | undefined
    signal: () => AbortSignal | undefined
    serve?: (options: ZoomMcpServeOptions) => Promise<void>
    preparation: ZoomPreparationOptions
  },
) =>
  program
    .command("serve")
    .description("serve read-only meeting tools over MCP stdio")
    .requiredOption("--mcp", "use the MCP JSON-RPC protocol")
    .option("--unified-search", "include selected-profile meetings-only unified search")
    .option("--meeting-context", "include account-fixed evidence, person context and task proposals")
    .option("--meeting-preparation", "include cited meeting preparation with remote Zoom schedule reads")
    .option("--semantic", "include read-only meeting vector search with an explicit query model")
    .option("--model <model>", "query embedding model: an installed one, or one served at --base-url")
    .option("--base-url <url>", "explicit remote embedding endpoint for semantic queries")
    .option("--dims <n>", "vector size the remote service returns, in dimensions", bytes)
    .action(
      async (options: {
        unifiedSearch?: boolean
        meetingContext?: boolean
        meetingPreparation?: boolean
        semantic?: boolean
        model?: string
        baseUrl?: string
        dims?: number
      }) => {
        const opts = program.opts()
        if (opts.json || opts.jsonl || deps.fields())
          throw new ZoomError("validation_error", "MCP stdio controls its own output; omit --json and --jsonl")
        if (!deps.serve) throw new ZoomError("configuration_error", "the MCP server adapter is not available")
        if (options.semantic)
          validateMeetingModel({ model: options.model ?? "", baseUrl: options.baseUrl, dims: options.dims })
        else if (options.model !== undefined || options.baseUrl !== undefined || options.dims !== undefined)
          throw new ZoomError("validation_error", "MCP model options require --semantic")
        if (options.semantic && options.baseUrl !== undefined && opts.offline)
          throw new ZoomError("configuration_error", "remote embeddings require network access; remove --offline")
        if (options.meetingPreparation && opts.offline)
          throw new ZoomError("configuration_error", "meeting preparation requires network access; remove --offline")
        await deps.serve({
          commandRegistry: program,
          signal: deps.signal() as AbortSignal,
          maxResultBytes: opts.maxOutputBytes,
          ...(options.unifiedSearch ? { includeUnifiedSearch: true } : {}),
          ...(options.meetingContext ? { includeMeetingContext: true } : {}),
          ...(options.meetingPreparation ? { preparation: deps.preparation } : {}),
          ...(options.semantic
            ? { semanticModel: { model: options.model ?? "", baseUrl: options.baseUrl, dims: options.dims } }
            : {}),
        })
      },
    )
