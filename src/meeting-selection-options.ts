import { dateWindow } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { bytes } from "./execution.js"

export interface SelectionFlags {
  eventId?: number
  project?: string
  topic?: string
  sinceTime?: string
  untilTime?: string
  timezone?: string
}

/** The meetings a stats, review or links answer covers: the options and the request they become. */
export const selectionOptions = (command: Command): Command =>
  command
    .option("--since-time <time>", "meetings starting at or after this date or time (ISO 8601, or 30d ago)")
    .option("--until-time <time>", "meetings starting at or before this date or time; a date alone is that whole day")
    .option("--timezone <zone>", "the IANA zone dates and weeks are read in (default: this computer's)")
    .option("--event-id <id>", "only meetings linked to this stored event", bytes)
    .option("--project <name>", "meetings confirmed in this project, by name, key or alias")
    .option("--topic <name>", "meetings with this topic, by name or alias")

export const selectionOf = (flags: SelectionFlags, signal?: AbortSignal, defaultSince?: string) => {
  const zone = flags.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const window = dateWindow({ sinceTime: flags.sinceTime ?? defaultSince, untilTime: flags.untilTime, zone })
  return {
    request: {
      ...(flags.eventId === undefined ? {} : { eventId: flags.eventId }),
      ...(flags.project === undefined ? {} : { project: flags.project }),
      ...(flags.topic === undefined ? {} : { topic: flags.topic }),
      ...(window.since === undefined ? {} : { since: window.since }),
      ...(window.until === undefined ? {} : { until: window.until }),
      ...(signal ? { signal } : {}),
    },
    zone,
    meta: { ...window.meta, timezone: zone },
  }
}
