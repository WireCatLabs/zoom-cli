import { annotate } from "@wirecat/cli-base/commands"
import { validateMeetingHitSearch } from "@wirecat/cli-messaging/meetings/cli"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"

export {
  addMeetingHitSearchCommand,
  type MeetingHitSearch,
  type MeetingHitSearchOptions,
  validateMeetingHitSearch,
} from "@wirecat/cli-messaging/meetings/cli"

export type MeetingSearchIndex = (options: {
  limit?: number
  maxReadBytes?: number
  apply?: boolean
  dryRun?: boolean
  signal?: AbortSignal
}) => Promise<{
  applied: boolean
  accountId: number
  indexed?: number
  remaining?: number
  request: { limit: number; maxReadBytes: number }
}>

export const addMeetingSearchIndexCommand = (
  program: Command,
  deps: {
    index: () => Promise<MeetingSearchIndex>
    signal: () => AbortSignal | undefined
    output: (value: unknown) => void
    receipt: (value: unknown) => Promise<void>
  },
) => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new ZoomError("configuration_error", "meeting command group is unavailable")
  annotate(
    meetings
      .command("search-index")
      .description("preview or apply one bounded batch of queued meeting search indexing")
      .option("--limit <count>", "queued record limit from 1 through 1000 (default 100)", bytes)
      .option("--max-read-bytes <bytes>", "raw SQL read budget from 1 through 67108864 (default 4194304)", bytes)
      .option("--yes", "apply this indexing batch once")
      .option("--dry-run", "preview even when --yes is present")
      .action(async (options: { limit?: number; maxReadBytes?: number; yes?: boolean; dryRun?: boolean }) => {
        validateMeetingHitSearch("index", options)
        const result = await (await deps.index())({
          limit: options.limit,
          maxReadBytes: options.maxReadBytes,
          apply: options.yes,
          dryRun: options.dryRun,
          signal: deps.signal(),
        })
        if (result.applied) await deps.receipt(result)
        else deps.output(result)
      }),
    { origin: "handwritten", mutates: true, local: true, examples: ["zm meetings search-index --yes --json"] },
  )
}
