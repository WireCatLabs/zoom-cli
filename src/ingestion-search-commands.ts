import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, itemOf, LOCAL_READ, LOCAL_WRITE, NO_EFFECTS } from "@wirecat/cli-core/cli"
import type { MeetingSearchCursor, ResourceWithMeetings } from "@wirecat/cli-core/services"
import type { Command } from "commander"
import type { ArchiveImportPlan, applyArchiveImport, preflightArchiveImport } from "./archive-import.js"
import { bytes } from "./execution.js"
import { camelKeys } from "./keys.js"
import { type UnifiedSearch, unifiedSearchAnswer, validateUnifiedSearch } from "./unified-search.js"

interface Deps {
  preflight: typeof preflightArchiveImport
  apply: (plan: ArchiveImportPlan) => ReturnType<typeof applyArchiveImport>
  signal: () => AbortSignal | undefined
  output: (body: Body) => void
  outputItems: (items: AsyncIterable<unknown>) => Promise<void>
  receipt: (body: Body) => Promise<void>
  search: UnifiedSearch
}
const cursor = (value: string): MeetingSearchCursor => {
  try {
    return camelKeys(JSON.parse(value)) as MeetingSearchCursor
  } catch {
    throw new CliError("validation_error", "meeting cursor must be a JSON object")
  }
}
export const addIngestionSearchCommands = (program: Command, deps: Deps): void => {
  const archive = program.commands
    .find((command) => command.name() === "recordings")
    ?.commands.find((command) => command.name() === "archive")
  if (!archive) throw new CliError("configuration_error", "archive command group is unavailable")
  annotate(
    archive
      .command("import")
      .description("check an archive's transcripts, then add them to the stored meetings")
      .argument("<directory>", "archive folder")
      .option("--uuid <uuid>", "select an occurrence UUID")
      .option("--file-ids <ids>", "select comma-separated transcript asset ids")
      .option("--max-bytes <bytes>", "largest transcript file, in bytes (default 8 MiB)", bytes)
      .option(
        "--max-total-bytes <bytes>",
        "most transcript bytes in all, checked before any write (default 64 MiB)",
        bytes,
      )
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
            for await (const receipt of receipts) await deps.receipt(itemOf(receipt))
          } else await deps.outputItems(receipts)
        },
      ),
    { origin: "handwritten", effects: LOCAL_WRITE, examples: ["zm recordings archive import ./archive --jsonl"] },
  )
  const search = annotate(program.command("search"), { effects: NO_EFFECTS }).description(
    "opt-in shared store search; meetings by default",
  )
  annotate(
    search
      .command("all")
      .description("search meetings and, with --only, messages, mail and notes in the local store")
      .argument("<query>", "words to find; a word also matches longer words it starts")
      .option("--only <resources>", "comma-separated meetings,messages,mail,notes (default meetings)")
      .option("--limit <n>", "how many results, 1 through 1000 (default 100)", bytes, 100)
      .option("--max-meetings <n>", "most meetings to look at, 1 through 1000 (default 100)", bytes, 100)
      .option("--meeting-cursor <json>", "source-only continuation from meetings.next_cursor", cursor)
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
          deps.output(unifiedSearchAnswer(await deps.search(request)))
        },
      ),
    { origin: "handwritten", effects: LOCAL_READ, partial: true, examples: ['zm search all "example plan" --json'] },
  )
}
