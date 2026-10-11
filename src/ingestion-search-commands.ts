import { annotate } from "@wirecat/cli-base/commands"
import type { MeetingSearchCursor, ResourceWithMeetings } from "@wirecat/cli-messaging/services"
import type { Command } from "commander"
import type { ArchiveImportPlan, applyArchiveImport, preflightArchiveImport } from "./archive-import.js"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"
import { type UnifiedSearch, validateUnifiedSearch } from "./unified-search.js"

interface Deps {
  preflight: typeof preflightArchiveImport
  apply: (plan: ArchiveImportPlan) => ReturnType<typeof applyArchiveImport>
  signal: () => AbortSignal | undefined
  output: (value: unknown) => void
  outputItems: (items: AsyncIterable<unknown>) => Promise<void>
  receipt: (value: unknown) => Promise<void>
  search: UnifiedSearch
}
const cursor = (value: string): MeetingSearchCursor => {
  try {
    return JSON.parse(value) as MeetingSearchCursor
  } catch {
    throw new ZoomError("validation_error", "meeting cursor must be a JSON object")
  }
}
export const addIngestionSearchCommands = (program: Command, deps: Deps): void => {
  const archive = program.commands
    .find((command) => command.name() === "recordings")
    ?.commands.find((command) => command.name() === "archive")
  if (!archive) throw new ZoomError("configuration_error", "archive command group is unavailable")
  annotate(
    archive
      .command("import")
      .description("verify all selected VTT before atomic per-occurrence transcript append")
      .argument("<directory>")
      .option("--uuid <uuid>", "select an occurrence UUID")
      .option("--file-ids <ids>", "select comma-separated VTT asset ids")
      .option("--max-bytes <bytes>", "per-file VTT byte limit (default 8 MiB)", bytes)
      .option("--max-total-bytes <bytes>", "aggregate VTT byte limit before any write (default 64 MiB)", bytes)
      .action(
        async (
          directory: string,
          options: { uuid?: string; fileIds?: string; maxBytes?: number; maxTotalBytes?: number },
        ) => {
          const plan = await deps.preflight(directory, {
            uuid: options.uuid,
            fileIds: options.fileIds?.split(",").map((id) => id.trim()),
            maxBytes: options.maxBytes,
            maxTotalBytes: options.maxTotalBytes,
            signal: deps.signal(),
          })
          const receipts = deps.apply(plan)
          if (program.opts().jsonl) {
            for await (const receipt of receipts) await deps.receipt(receipt)
          } else await deps.outputItems(receipts)
        },
      ),
    { origin: "handwritten", mutates: true, local: true, examples: ["zm recordings archive import ./archive --jsonl"] },
  )
  const search = program.command("search").description("opt-in shared store search; meetings by default")
  annotate(
    search
      .command("all")
      .description(
        "meeting word prefixes plus selected resources; notes are store-global; JSONL emits one complete report",
      )
      .argument("<query>")
      .option("--only <resources>", "comma-separated meetings,messages,mail,notes (default meetings)")
      .option("--limit <items>", "result bound 1 through 1000 (default 100)", bytes, 100)
      .option("--max-meetings <count>", "candidate meeting scan bound 1 through 1000 (default 100)", bytes, 100)
      .option("--meeting-cursor <json>", "source-only continuation from meetings.nextCursor", cursor)
      .option("--exact", "request exact matching; unsupported meeting queries are reported as skipped")
      .action(
        async (
          query: string,
          options: {
            only?: string
            limit: number
            maxMeetings: number
            meetingCursor?: MeetingSearchCursor
            exact?: boolean
          },
        ) => {
          const request = validateUnifiedSearch({
            text: query,
            limit: options.limit,
            maxMeetings: options.maxMeetings,
            only: options.only?.split(",").map((value) => value.trim()) as ResourceWithMeetings[] | undefined,
            exact: options.exact,
            meetingCursor: options.meetingCursor,
            signal: deps.signal(),
          })
          deps.output(await deps.search(request))
        },
      ),
    { origin: "handwritten", mutates: false, examples: ['zm search all "example plan" --json'] },
  )
}
