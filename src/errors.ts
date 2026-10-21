import { CliError, isCliError } from "@wirecat/cli-base"
import { timezoneOf, wallTime } from "@wirecat/cli-base/query"
import type { JsonValue } from "@wirecat/cli-core/meetings"

export const checkCancelled = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return
  if (isCliError(signal.reason)) throw signal.reason
  const timedOut = signal.reason instanceof Error && signal.reason.name === "TimeoutError"
  throw new CliError(timedOut ? "timeout" : "cancelled", timedOut ? "command timed out" : "command cancelled")
}
export const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new CliError("invalid_response", "Zoom returned an invalid response")
  return value as Record<string, unknown>
}
export const string = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null)
export const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null
/** Epoch ms of a Zoom date-time, which must name its zone: a time without one would be read in the process zone. */
export const zoomInstant = (text: string, message: string): number => {
  const invalid = () => new CliError("invalid_response", message)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) throw invalid()
  const local = text.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "Z")
  const date = new Date(local)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== local.slice(0, 19)) throw invalid()
  const stamp = Date.parse(text)
  if (!Number.isSafeInteger(stamp)) throw invalid()
  return stamp
}
export const TIME_WITHOUT_ZONE = "time_without_zone"
/** Zoom times read without a zone during one command, so the answer can warn once. */
export class ZoneAssumptions {
  private count = 0
  private readonly zones = new Set<string>()
  add(zone: string): void {
    this.count++
    this.zones.add(zone)
  }
  take(): string[] {
    if (this.count === 0) return []
    const notice = `${this.count} Zoom ${this.count === 1 ? "time had" : "times had"} no zone; read in ${[...this.zones].join(" or ")} and marked ${TIME_WITHOUT_ZONE}`
    this.count = 0
    this.zones.clear()
    return [notice]
  }
}
/**
 * A Zoom response time. One without a zone is local time by Zoom's rule
 * (https://developers.zoom.us/docs/api/using-zoom-apis/, "Time in Zoom API"), so it is read in the computer's zone,
 * or in UTC when daylight saving makes that local time skipped or repeated; `zone` says which was assumed.
 */
export const zoomTime = (text: string, message: string): { time: number; zone: string | null } => {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return { time: zoomInstant(text, message), zone: null }
  const utc = zoomInstant(`${text}Z`, message)
  const zone = timezoneOf()
  try {
    return { time: wallTime(text.replace(/(\.\d{3})\d+$/, "$1"), zone, { start: 0, end: text.length }), zone }
  } catch {
    return { time: utc, zone: "UTC" }
  }
}
export const withIssue = (metadata: Record<string, JsonValue>, doubtful: boolean): Record<string, JsonValue> =>
  doubtful ? { ...metadata, issues: [TIME_WITHOUT_ZONE] } : metadata
