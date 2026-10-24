import { CliError } from "@wirecat/cli-base"
import { defineQuery } from "@wirecat/cli-base/query"
import { dateWindow, queryTerms } from "@wirecat/cli-core/cli"
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
  ],
})

export const selectionOptions = (command: Command, list = false): Command => {
  command
    .option("--since-time <time>", "meetings starting at or after this date or time (ISO 8601, or 30d ago)")
    .option("--until-time <time>", "meetings starting at or before this date or time; a date alone is that whole day")
    .option("--timezone <zone>", "the IANA zone dates and weeks are read in (default: this computer's)")
  if (!list)
    command
      .option("--event-id <id>", "only meetings linked to this stored event", bytes)
      .option("--project <project>", "meetings confirmed in this project, by name, key or alias")
      .option("--topic-name <name>", "meetings with this topic label, by name or alias")
  return command
}

export const linkSelection = (words: string[], flags: SelectionFlags): SelectionFlags => {
  const terms = queryTerms(words, MEETING_LINK_QUERY, "mentions list")
  const event = terms.get("event_id")
  if (event !== undefined && (!/^[1-9]\d*$/.test(event) || !Number.isSafeInteger(Number(event))))
    throw new CliError("validation_error", "event_id must be a positive safe integer")
  return {
    ...flags,
    ...(event === undefined ? {} : { eventId: Number(event) }),
    ...(terms.get("project") === undefined ? {} : { project: terms.get("project") }),
    ...(terms.get("topic") === undefined ? {} : { topicName: terms.get("topic") }),
  }
}

export const selectionOf = (flags: SelectionFlags, signal?: AbortSignal, defaultSince?: string) => {
  const zone = flags.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const window = dateWindow({ sinceTime: flags.sinceTime ?? defaultSince, untilTime: flags.untilTime, zone })
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
