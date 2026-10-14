import type { MeetingOccurrence, MeetingOccurrenceSchedule } from "@wirecat/cli-core/meetings"
import { object, ZoomError } from "./errors.js"

function invalid(field: string): never {
  throw new ZoomError("invalid_response", `Zoom meeting ${field} is invalid`)
}
const instant = (value: unknown): number | null => {
  if (value === undefined || value === null) return null
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    invalid("start_time")
  const local = value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "Z")
  const date = new Date(local)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== local.slice(0, 19)) invalid("start_time")
  const stamp = Date.parse(value)
  if (!Number.isSafeInteger(stamp)) invalid("start_time")
  return stamp
}
const end = (start: number | null, value: unknown): number | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid("duration")
  if (start === null || value === 0) return null
  const stamp = start + value * 60000
  if (!Number.isSafeInteger(stamp) || Math.abs(stamp) > 8_640_000_000_000_000) invalid("duration")
  return stamp
}
const occurrence = (value: unknown): MeetingOccurrence => {
  const row = object(value)
  if (
    typeof row.occurrence_id !== "string" ||
    !row.occurrence_id.trim() ||
    row.occurrence_id.length > 1000 ||
    /[\0\r\n]/.test(row.occurrence_id)
  )
    invalid("occurrence_id")
  if (row.status !== "available" && row.status !== "deleted") invalid("occurrence status")
  const startAt = instant(row.start_time)
  return {
    id: row.occurrence_id,
    startAt,
    endAt: end(startAt, row.duration),
    status: row.status === "deleted" ? "cancelled" : "scheduled",
    verified: startAt !== null,
  }
}
export const zoomOccurrenceSchedule = (value: unknown, meetingId: string, limit: number): MeetingOccurrenceSchedule => {
  const row = object(value)
  const id = typeof row.id === "number" && Number.isSafeInteger(row.id) ? String(row.id) : row.id
  if (id !== meetingId) invalid("id")
  if (row.timezone !== undefined && row.timezone !== null && typeof row.timezone !== "string") invalid("timezone")
  const timezone = typeof row.timezone === "string" ? row.timezone : null
  if (row.type === 2) {
    const startAt = instant(row.start_time)
    const known = startAt !== null && (row.status === undefined || row.status === "waiting")
    return {
      meetingId,
      kind: "single",
      timezone,
      occurrences: [{ id: null, startAt, endAt: end(startAt, row.duration), status: "scheduled", verified: known }],
      complete: known,
      missing: known ? [] : ["occurrence-details"],
    }
  }
  if (row.type === 3)
    return {
      meetingId,
      kind: "unscheduled",
      timezone,
      occurrences: [],
      complete: false,
      missing: ["occurrence-details"],
    }
  if (row.type !== 8)
    return { meetingId, kind: "unknown", timezone, occurrences: [], complete: false, missing: ["schedule-details"] }
  if (row.occurrences === undefined || row.occurrences === null)
    return { meetingId, kind: "recurring", timezone, occurrences: [], complete: false, missing: ["occurrence-details"] }
  if (!Array.isArray(row.occurrences) || row.occurrences.length > limit) invalid("occurrence row budget")
  const occurrences = row.occurrences.map(occurrence)
  const recurrence = row.recurrence === undefined || row.recurrence === null ? {} : object(row.recurrence)
  const count = recurrence.end_times
  if (count !== undefined && (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0))
    invalid("recurrence end_times")
  // An array alone does not prove the coverage of a date-ended or open series.
  const complete =
    typeof count === "number" &&
    count > 0 &&
    count === occurrences.length &&
    recurrence.end_date_time == null &&
    occurrences.every((entry) => entry.startAt !== null)
  return {
    meetingId,
    kind: "recurring",
    timezone,
    occurrences,
    complete,
    missing: complete ? [] : ["schedule-details"],
  }
}
