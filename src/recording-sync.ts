import { checkCancelled, ZoomError } from "./errors.js"
import { validateDownloadOptions } from "./recording-archive.js"
import type { ArchiveReport, DownloadOptions, RecordingMeeting, ZoomRecordings } from "./recordings.js"
import { operationSignal } from "./remote-http.js"

export interface ArchiveSyncOptions extends Omit<DownloadOptions, "fileIds"> {
  from: string
  to: string
}
export interface ArchiveSyncReceipt {
  window: { from: string; to: string }
  meeting: Pick<RecordingMeeting, "id" | "uuid" | "title">
  archive: ArchiveReport
}
const date = (value: string): Date => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ZoomError("validation_error", "archive dates must be valid YYYY-MM-DD dates")
  const result = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value)
    throw new ZoomError("validation_error", "archive dates must be valid YYYY-MM-DD dates")
  return result
}
const label = (value: Date) => value.toISOString().slice(0, 10)
export async function* syncRecordingArchive(
  recordings: Pick<ZoomRecordings, "list" | "download">,
  options: ArchiveSyncOptions,
): AsyncGenerator<ArchiveSyncReceipt, void, void> {
  const from = date(options.from)
  const to = date(options.to)
  const anniversary = new Date(from)
  const lastDay = new Date(from)
  lastDay.setUTCFullYear(from.getUTCFullYear() + 10, from.getUTCMonth() + 1, 0)
  anniversary.setUTCFullYear(
    from.getUTCFullYear() + 10,
    from.getUTCMonth(),
    Math.min(from.getUTCDate(), lastDay.getUTCDate()),
  )
  if (to < from || to > anniversary)
    throw new ZoomError("validation_error", "archive date range must be ordered and at most ten calendar years")
  validateDownloadOptions(options)
  const signal = operationSignal(options.signal)
  const seen = new Set<string>()
  let cursor = from
  while (cursor <= to) {
    checkCancelled(signal)
    const end = new Date(cursor)
    end.setUTCMonth(end.getUTCMonth() + 1, 0)
    const upper = new Date(Math.min(end.getTime(), to.getTime()))
    const window = { from: label(cursor), to: label(upper) }
    const meetings = await recordings.list({ ...window, signal })
    for (const meeting of meetings) {
      checkCancelled(signal)
      if (seen.has(meeting.uuid)) continue
      seen.add(meeting.uuid)
      const archive = await recordings.download(meeting.uuid, {
        destination: options.destination,
        signal,
        ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      })
      yield { window, meeting: { id: meeting.id, uuid: meeting.uuid, title: meeting.title }, archive }
    }
    cursor = new Date(upper)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}
