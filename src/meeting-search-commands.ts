import { annotate } from "@wirecat/cli-core/commands"
import type { MeetingSearchOptions, MeetingSearchPage } from "@wirecat/cli-meetings"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"

export type MeetingHitSearchOptions = Omit<MeetingSearchOptions, "accountId">
export type MeetingHitSearch = (query: string, options: MeetingHitSearchOptions) => Promise<MeetingSearchPage>
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

export const validateMeetingHitSearch = (query: string, options: MeetingHitSearchOptions = {}) => {
  const integer = (value: number, low: number, high: number) =>
    Number.isSafeInteger(value) && value >= low && value <= high
  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.includes("\0") ||
    new TextEncoder().encode(query).byteLength > 65536 ||
    !integer(options.limit ?? 100, 1, 1000) ||
    !integer(options.maxReadBytes ?? 4194304, 1, 67108864) ||
    (options.meetingId !== undefined && !integer(options.meetingId, 1, Number.MAX_SAFE_INTEGER)) ||
    (options.since !== undefined && !integer(options.since, -8640000000000000, 8640000000000000)) ||
    (options.until !== undefined && !integer(options.until, -8640000000000000, 8640000000000000)) ||
    (options.since !== undefined && options.until !== undefined && options.since > options.until) ||
    (options.after !== undefined &&
      (typeof options.after !== "string" || !/^[A-Za-z0-9_-]{1,1000}$/.test(options.after)))
  )
    throw new ZoomError("validation_error", "invalid bounded meeting search query, cursor or limits")
}
const timestamp = (value: string): number => {
  const parsed = Date.parse(value)
  const date = value.slice(0, 10)
  const day = Date.parse(`${date}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T.+(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) ||
    !Number.isFinite(parsed) ||
    !Number.isFinite(day) ||
    new Date(day).toISOString().slice(0, 10) !== date
  )
    throw new ZoomError("validation_error", "meeting search dates require a real ISO date or timestamp with offset")
  return parsed
}
export const addMeetingHitSearchCommand = (
  program: Command,
  deps: {
    search: () => Promise<MeetingHitSearch>
    signal: () => AbortSignal | undefined
    output: (value: unknown) => void
  },
) => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new ZoomError("configuration_error", "meeting command group is unavailable")
  annotate(
    meetings
      .command("search-page")
      .description("bounded keyword search with configured stemming and hit continuation")
      .argument("<query>")
      .option("--meeting-id <id>", "restrict to a meeting in the selected account", bytes)
      .option("--since <date>", "meeting start at or after an ISO date or timestamp", timestamp)
      .option("--until <date>", "meeting start at or before an ISO date or timestamp", timestamp)
      .option("--limit <count>", "hit limit from 1 through 1000 (default 100)", bytes)
      .option("--after <cursor>", "opaque nextCursor from the same query and selected account")
      .option("--max-read-bytes <bytes>", "raw SQL read budget from 1 through 67108864 (default 4194304)", bytes)
      .action(async (query: string, options: MeetingHitSearchOptions) => {
        validateMeetingHitSearch(query, options)
        const request = {
          meetingId: options.meetingId,
          since: options.since,
          until: options.until,
          limit: options.limit,
          after: options.after,
          maxReadBytes: options.maxReadBytes,
          signal: deps.signal(),
        }
        deps.output(await (await deps.search())(query, request))
      }),
    { origin: "handwritten", mutates: false, examples: ['zm meetings search-page "Alice Example" --limit 20 --json'] },
  )
}

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
