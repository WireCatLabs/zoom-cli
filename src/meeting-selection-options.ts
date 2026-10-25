import { CliError } from "@wirecat/cli-base"
import { dateRange, defineQuery, type Predicate, queryFieldsOf } from "@wirecat/cli-base/query"
import { dateWindow, listQuery, nativeTerms, typedQuery } from "@wirecat/cli-core/cli"
import { meetingLink } from "@wirecat/cli-core/meetings"
import type { Command } from "commander"
import { bytes } from "./execution.js"

export interface SelectionFlags {
  eventId?: number
  project?: string
  topic?: string
  topicName?: string
  sinceTime?: string
  untilTime?: string
  timezone?: string
}

/** The meetings a stats, review or links answer covers: the options and the request they become. */
export const MEETING_LINK_QUERY = defineQuery({
  entity: "meeting_link",
  backend: "native",
  fields: [
    ...queryFieldsOf(meetingLink, { native: ["url"], examples: { url: 'url:"https://example.com/plan"' } }).map(
      (field) => (field.native ? { ...field, operators: ["term" as const, "phrase" as const] } : field),
    ),
    {
      name: "event_id",
      native: true,
      type: "num",
      operators: ["term"],
      example: "event_id:1",
      relation: "meetings linked to this event",
    },
    {
      name: "project",
      native: true,
      type: "kw",
      operators: ["term", "phrase"],
      example: "project:RES",
      relation: "meetings confirmed in this project",
    },
    {
      name: "topic",
      native: true,
      type: "kw",
      operators: ["term", "phrase"],
      example: "topic:planning",
      relation: "meetings with this topic",
    },
    {
      name: "started_at",
      native: true,
      type: "time",
      operators: ["term", "phrase", "range"],
      example: "started_at>=30d",
      relation: "meetings that started in this window",
    },
  ],
})

export const selectionOptions = (command: Command, list = false): Command => {
  if (!list)
    command
      .option("--since-time <time>", "meetings starting at or after this date or time (ISO 8601, or 30d ago)")
      .option("--until-time <time>", "meetings starting at or before this date or time; a date alone is that whole day")
  command.option("--timezone <zone>", "the IANA zone dates and weeks are read in (default: this computer's)")
  if (!list)
    command
      .option("--event-id <id>", "only meetings linked to this stored event", bytes)
      .option("--project <project>", "meetings confirmed in this project, by name, key or alias")
      .option("--topic-name <name>", "meetings with this topic label, by name or alias")
  return command
}

type MeetingWindow = ReturnType<typeof dateWindow>

/** The meeting readers take inclusive bounds, as `dateWindow` gives them; a query range may exclude its ends. */
const startedWindow = (node: Predicate, zone: string): MeetingWindow => {
  const range = node.operator === "range"
  const { lower, upper, lower_inclusive, upper_inclusive } = dateRange(
    node.value,
    range ? (node.upper ?? "*") : node.value,
    range ? node.lower_inclusive !== false : true,
    range ? node.upper_inclusive !== false : true,
    zone,
    node.span,
  )
  const since = lower === undefined ? undefined : lower_inclusive ? lower : lower + 1
  const until = upper === undefined ? undefined : upper_inclusive ? upper : upper - 1
  return {
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    meta: {
      timezone: zone,
      window: {
        ...(since === undefined ? {} : { since: new Date(since).toISOString() }),
        ...(until === undefined ? {} : { until: new Date(until).toISOString() }),
      },
    },
  }
}

export const linkSelection = (
  words: string[],
  flags: SelectionFlags,
): SelectionFlags & { url?: string; window?: MeetingWindow } => {
  const command = "mentions list"
  const nodes = nativeTerms(listQuery(typedQuery(words), MEETING_LINK_QUERY, command), command)
  const terms = new Map<string, string>()
  for (const [field, node] of nodes) if (field !== "started_at") terms.set(field, node.value)
  const event = terms.get("event_id")
  if (event !== undefined && (!/^[1-9]\d*$/.test(event) || !Number.isSafeInteger(Number(event))))
    throw new CliError("validation_error", "event_id must be a positive safe integer")
  const started = nodes.get("started_at")
  return {
    ...flags,
    ...(event === undefined ? {} : { eventId: Number(event) }),
    ...(terms.get("url") === undefined ? {} : { url: terms.get("url") }),
    ...(terms.get("project") === undefined ? {} : { project: terms.get("project") }),
    ...(terms.get("topic") === undefined ? {} : { topicName: terms.get("topic") }),
    ...(started === undefined ? {} : { window: startedWindow(started, flags.timezone ?? zoneHere()) }),
  }
}

const zoneHere = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export const selectionOf = (
  flags: SelectionFlags & { window?: MeetingWindow },
  signal?: AbortSignal,
  defaultSince?: string,
) => {
  const zone = flags.timezone ?? zoneHere()
  const window =
    flags.window ?? dateWindow({ sinceTime: flags.sinceTime ?? defaultSince, untilTime: flags.untilTime, zone })
  return {
    request: {
      ...(flags.eventId === undefined ? {} : { eventId: flags.eventId }),
      ...(flags.project === undefined ? {} : { project: flags.project }),
      ...((flags.topicName ?? flags.topic) === undefined ? {} : { topic: flags.topicName ?? flags.topic }),
      ...(window.since === undefined ? {} : { since: window.since }),
      ...(window.until === undefined ? {} : { until: window.until }),
      ...(signal ? { signal } : {}),
    },
    zone,
    meta: { ...window.meta, timezone: zone },
  }
}
