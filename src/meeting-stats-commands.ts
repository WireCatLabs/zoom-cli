import { annotate } from "@wirecat/cli-base/commands"
import { type Body, dateWindow, itemOf, LOCAL_READ, listOf, NO_EFFECTS } from "@wirecat/cli-core/cli"
import type { MeetingStats } from "@wirecat/cli-core/meetings"
import type { MeetingStatsRequest } from "@wirecat/cli-core/services"
import type { Command } from "commander"
import { bytes } from "./execution.js"

interface StatsFlags {
  eventId?: number
  project?: string
  topic?: string
  sinceTime?: string
  untilTime?: string
  timezone?: string
  maxRows?: number
  limit?: number
}

export type MeetingStatsRead = (request: Omit<MeetingStatsRequest, "accountId">) => Promise<MeetingStats>

const filters = (command: Command): Command =>
  command
    .option("--since-time <time>", "meetings starting at or after this date or time (ISO 8601, or 30d ago)")
    .option("--until-time <time>", "meetings starting at or before this date or time; a date alone is that whole day")
    .option("--timezone <zone>", "the IANA zone dates and weeks are read in (default: this computer's)")
    .option("--event-id <id>", "only meetings linked to this stored event", bytes)
    .option("--project <name>", "meetings confirmed in this project, by name, key or alias")
    .option("--topic <name>", "meetings with this topic, by name or alias")
    .option("--max-rows <n>", "most transcript lines to read (default and at most 500000)", bytes)

const requestOf = (flags: StatsFlags, signal?: AbortSignal) => {
  const zone = flags.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const window = dateWindow({ sinceTime: flags.sinceTime, untilTime: flags.untilTime, zone })
  return {
    request: {
      ...(flags.eventId === undefined ? {} : { eventId: flags.eventId }),
      ...(flags.project === undefined ? {} : { project: flags.project }),
      ...(flags.topic === undefined ? {} : { topic: flags.topic }),
      ...(window.since === undefined ? {} : { since: window.since }),
      ...(window.until === undefined ? {} : { until: window.until }),
      ...(flags.maxRows === undefined ? {} : { maxRows: flags.maxRows }),
      timeZone: zone,
      ...(signal ? { signal } : {}),
    },
    meta: { ...window.meta, timezone: zone },
  }
}

const speaker = (one: MeetingStats["speakers"][number]) => ({
  key: one.key,
  name: one.name,
  person_id: one.personId,
  identity_id: one.identityId,
  meetings: one.meetings,
  lines: one.lines,
  words: one.words,
  talk_ms: one.talkMs,
  share: one.share,
})

/**
 * `stats meetings show|top`: how much was said, by whom, and in which weeks, over the meetings search would read.
 * Numbers only; no transcript text is read or shown.
 */
export const addMeetingStatsCommands = (
  program: Command,
  deps: { read: () => Promise<MeetingStatsRead>; signal: () => AbortSignal | undefined; output: (body: Body) => void },
): void => {
  const stats =
    program.commands.find((command) => command.name() === "stats") ??
    annotate(program.command("stats"), { effects: NO_EFFECTS }).description("numbers about the stored meetings")
  const meetings = annotate(stats.command("meetings"), { effects: NO_EFFECTS }).description(
    "talk time, lines and words, by speaker and by week",
  )
  annotate(filters(meetings.command("show")), {
    effects: LOCAL_READ,
    examples: ["zm personal stats meetings show --since-time 30d --json"],
  })
    .description("meetings, lines, words and talk time by week, with the top speakers")
    .action(async (flags: StatsFlags) => {
      const { request, meta } = requestOf(flags, deps.signal())
      const found = await (await deps.read())(request)
      deps.output(
        itemOf(
          {
            time_zone: found.timeZone,
            meetings: found.meetings,
            lines: found.lines,
            words: found.words,
            talk_ms: found.talkMs,
            weeks: found.weeks.map((week) => ({
              week_start: week.weekStart,
              meetings: week.meetings,
              talk_ms: week.talkMs,
            })),
            top_speakers: found.speakers.slice(0, 10).map(speaker),
          },
          { meta },
        ),
      )
    })
  annotate(filters(meetings.command("top")), {
    effects: LOCAL_READ,
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
          items: found.speakers.slice(0, limit).map(speaker),
          limit,
          has_more: found.speakers.length > limit,
          meta,
        }),
      )
    })
}
