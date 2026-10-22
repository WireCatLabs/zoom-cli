import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { FETCH, type MeetingSeriesInventoryReader } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { bytes } from "./execution.js"
import type { createZoomInventoryReader } from "./meeting-inventory.js"
import type { ZoomPreparationOptions } from "./meeting-preparation.js"
import { type MeetingModelOptions, validateMeetingModel } from "./meeting-semantic-commands.js"

export interface ZoomMcpServeOptions {
  signal: AbortSignal
  profile: string
  commandRegistry: Command
  maxResultBytes?: number
  includeUnifiedSearch?: boolean
  includeMeetingContext?: boolean
  includeMeetingProjectCandidates?: boolean
  semanticModel?: MeetingModelOptions
  preparation?: ZoomPreparationOptions
  inventory?: MeetingSeriesInventoryReader
}
export const addZoomMcpCommand = (
  program: Command,
  deps: {
    fields: () => string[] | undefined
    signal: () => AbortSignal | undefined
    serve?: (options: ZoomMcpServeOptions) => Promise<void>
    profile: () => string
    preparation: ZoomPreparationOptions
    inventory?: ReturnType<typeof createZoomInventoryReader>
  },
) =>
  annotate(program.command("serve"), { effects: FETCH, lifetime: "persistent" })
    .description("serve read-only meeting tools over MCP stdio")
    .requiredOption("--mcp", "use the MCP JSON-RPC protocol")
    .option("--unified-search", "include selected-profile meetings-only unified search")
    .option("--meeting-context", "include account-fixed evidence, person context and task proposals")
    .option(
      "--meeting-project-candidates",
      "include stored meeting project suggestions using the global project vocabulary",
    )
    .option("--meeting-inventory", "include bounded remote meeting-series discovery with unverified date hints")
    .option("--meeting-preparation", "include cited meeting preparation with remote Zoom schedule reads")
    .option("--semantic", "include read-only meeting vector search with an explicit query model")
    .option("--model <model>", "query embedding model: an installed one, or one served at --base-url")
    .option("--base-url <url>", "explicit remote embedding endpoint for semantic queries")
    .option("--dims <n>", "vector size the remote service returns, in dimensions", bytes)
    .action(
      async (options: {
        unifiedSearch?: boolean
        meetingContext?: boolean
        meetingProjectCandidates?: boolean
        meetingPreparation?: boolean
        meetingInventory?: boolean
        semantic?: boolean
        model?: string
        baseUrl?: string
        dims?: number
      }) => {
        const opts = program.opts()
        if (opts.json || opts.jsonl || deps.fields())
          throw new CliError("validation_error", "MCP stdio controls its own output; omit --json and --jsonl")
        if (!deps.serve) throw new CliError("configuration_error", "the MCP server adapter is not available")
        if (options.semantic)
          validateMeetingModel({ model: options.model ?? "", baseUrl: options.baseUrl, dims: options.dims })
        else if (options.model !== undefined || options.baseUrl !== undefined || options.dims !== undefined)
          throw new CliError("validation_error", "MCP model options require --semantic")
        if (options.semantic && options.baseUrl !== undefined && opts.offline)
          throw new CliError("configuration_error", "remote embeddings require network access; remove --offline")
        if (options.meetingPreparation && opts.offline)
          throw new CliError("configuration_error", "meeting preparation requires network access; remove --offline")
        if (options.meetingInventory && opts.offline)
          throw new CliError("configuration_error", "meeting inventory requires network access; remove --offline")
        const inventory = options.meetingInventory ? deps.inventory : undefined
        if (options.meetingInventory && !inventory)
          throw new CliError("configuration_error", "meeting inventory capability is unavailable")
        inventory?.capture()
        await deps.serve({
          profile: deps.profile(),
          commandRegistry: program,
          signal: deps.signal() as AbortSignal,
          maxResultBytes: opts.maxOutputBytes,
          ...(options.unifiedSearch ? { includeUnifiedSearch: true } : {}),
          ...(options.meetingProjectCandidates ? { includeMeetingProjectCandidates: true } : {}),
          ...(options.meetingContext ? { includeMeetingContext: true } : {}),
          ...(inventory ? { inventory: inventory.read } : {}),
          ...(options.meetingPreparation ? { preparation: deps.preparation } : {}),
          ...(options.semantic
            ? { semanticModel: { model: options.model ?? "", baseUrl: options.baseUrl, dims: options.dims } }
            : {}),
        })
      },
    )
