import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, itemOf, LOCAL_READ, listOf, NO_EFFECTS } from "@wirecat/cli-core/cli"
import {
  MEETING_COUNTS_GROUPINGS,
  type MeetingCounts,
  type MeetingCountsGrouping,
  type MeetingStats,
  meetingCountsItem,
  meetingSpeakerItem,
  meetingStatsItem,
} from "@wirecat/cli-core/meetings"
import type { MeetingCountsRequest, MeetingStatsRequest } from "@wirecat/cli-core/services"
import type { Command } from "commander"
import { bytes } from "./execution.js"
import { type SelectionFlags, selectionOf, selectionOptions } from "./meeting-selection-options.js"

interface StatsFlags extends SelectionFlags {
  maxRows?: number
  limit?: number
}

export type MeetingStatsRead = (request: Omit<MeetingStatsRequest, "accountId">) => Promise<MeetingStats>
export type MeetingCountsRead = (request: Omit<MeetingCountsRequest, "accountId">) => Promise<MeetingCounts>

const groupingOf = (value: string): MeetingCountsGrouping => {
  if (!(MEETING_COUNTS_GROUPINGS as readonly string[]).includes(value))
    throw new CliError("validation_error", `--by takes ${MEETING_COUNTS_GROUPINGS.join(", ")}`)
  return value as MeetingCountsGrouping
}

const filters = (command: Command): Command =>
  selectionOptions(command).option(
    "--max-rows <n>",
    "most transcript lines to read (default and at most 500000)",
    bytes,
  )

const requestOf = (flags: StatsFlags, signal?: AbortSignal) => {
  const { request, zone, meta } = selectionOf(flags, signal)
  return {
    request: { ...request, ...(flags.maxRows === undefined ? {} : { maxRows: flags.maxRows }), timeZone: zone },
    meta,
  }
}

/**
 * `stats meetings show|top`: how much was said, by whom, and in which weeks, over the meetings search would read.
 * Numbers only; no transcript text is read or shown.
 */
export const addMeetingStatsCommands = (
  program: Command,
  deps: {
    read: () => Promise<MeetingStatsRead>
    counts: () => Promise<MeetingCountsRead>
    signal: () => AbortSignal | undefined
    output: (body: Body) => void
  },
): void => {
  const stats =
    program.commands.find((command) => command.name() === "stats") ??
    annotate(program.command("stats"), { effects: NO_EFFECTS }).description("numbers about the stored meetings")
  const meetings = annotate(stats.command("meetings"), { effects: NO_EFFECTS }).description(
    "talk time, lines and words by speaker and week; meetings and minutes by day, week or series",
  )
  annotate(filters(meetings.command("show")), {
    effects: LOCAL_READ,
    output: { entity: "meeting_stats" },
    examples: ["zm personal stats meetings show --since-time 30d --json"],
  })
    .description("meetings, lines, words and talk time by week, with the top speakers")
    .action(async (flags: StatsFlags) => {
      const { request, meta } = requestOf(flags, deps.signal())
      const found = await (await deps.read())(request)
      deps.output(itemOf(meetingStatsItem(found), { meta }))
    })
  annotate(filters(meetings.command("top")), {
    effects: LOCAL_READ,
    output: { entity: "meeting_speaker" },
    examples: ["zm personal stats meetings top --project RES --limit 5 --json"],
  })
    .description("speakers by talk time: lines, words, meetings and their share of the talk")
    .option("--limit <n>", "how many speakers (default 20)", bytes)
    .action(async (flags: StatsFlags) => {
      const { request, meta } = requestOf(flags, deps.signal())
      const found = await (await deps.read())(request)
      const limit = flags.limit ?? 20
      deps.output(
        listOf("stats meetings top", {
          items: found.speakers.slice(0, limit).map(meetingSpeakerItem),
          limit,
          has_more: found.speakers.length > limit,
          meta,
        }),
      )
    })
  annotate(selectionOptions(meetings.command("history")), {
    effects: LOCAL_READ,
    output: { entity: "meeting_counts" },
    examples: ["zm personal stats meetings history --by week --since-time 90d --json"],
  })
    .description("meetings, minutes and meetings with a transcript, per day, week or series; reads meetings only")
    .requiredOption("--by <grouping>", `one row per ${MEETING_COUNTS_GROUPINGS.join(", ")}`, groupingOf)
    .option("--limit <n>", "the newest days or weeks, or the busiest series (default 100)", bytes)
    .action(async (flags: SelectionFlags & { by: MeetingCountsGrouping; limit?: number }) => {
      const { request, zone, meta } = selectionOf(flags, deps.signal())
      const found = await (await deps.counts())({
        ...request,
        by: flags.by,
        timeZone: zone,
        ...(flags.limit === undefined ? {} : { limit: flags.limit }),
      })
      deps.output(itemOf(meetingCountsItem(found), { meta }))
    })
}
