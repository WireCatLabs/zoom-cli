import { encodeUuid } from "./api.js"
import { object, string, ZoomError } from "./errors.js"
import { type ArchiveReport, archiveRecording, type DownloadOptions } from "./recording-archive.js"
import { operationSignal, type RemoteOptions, ZoomRemote } from "./remote-http.js"
import type { TokenManager } from "./tokens.js"

export interface RecordingAsset {
  id: string | null
  type: string
  format: string | null
  size: number | null
  status: string
  available: boolean
  startedAt: string | null
  endedAt: string | null
}
export interface RecordingMeeting {
  id: string
  uuid: string
  title: string | null
  startedAt: string | null
  assets: RecordingAsset[]
}
export interface RecordingRange {
  from: string
  to: string
  signal?: AbortSignal
}
export const required = (value: unknown): string => {
  const text = string(value)
  if (text === null) throw new ZoomError("invalid_response", "Zoom response is missing a required field")
  return text
}
const timestamp = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null
  const text = required(value)
  if (!Number.isFinite(Date.parse(text))) throw new ZoomError("invalid_response", "Zoom returned an invalid timestamp")
  return new Date(text).toISOString()
}
const meeting = (value: unknown): RecordingMeeting => {
  const row = object(value)
  const id = typeof row.id === "number" && Number.isSafeInteger(row.id) ? String(row.id) : required(row.id)
  if (!Array.isArray(row.recording_files))
    throw new ZoomError("invalid_response", "Zoom returned invalid recording files")
  const all = [
    ...row.recording_files,
    ...(Array.isArray(row.participant_audio_files) ? row.participant_audio_files : []),
  ]
  const seen = new Set<string>()
  const assets = all.map((value): RecordingAsset => {
    const asset = object(value)
    const id = string(asset.id)
    if (id !== null && seen.has(id)) throw new ZoomError("invalid_response", "Zoom repeated a recording file id")
    if (id !== null) seen.add(id)
    return {
      id,
      type: string(asset.recording_type) ?? string(asset.file_type) ?? "unknown",
      format:
        string(asset.file_extension) ??
        { TRANSCRIPT: "VTT", CC: "VTT", CHAT: "TXT", CHAT_MESSAGE: "TXT", SUMMARY: "JSON", TIMELINE: "JSON" }[
          String(asset.file_type)
        ] ??
        string(asset.file_type),
      size:
        typeof asset.file_size === "number" && Number.isSafeInteger(asset.file_size) && asset.file_size >= 0
          ? asset.file_size
          : null,
      status: id === null ? "unsupported" : (string(asset.status) ?? "unknown"),
      available: id !== null && asset.status === "completed" && string(asset.download_url) !== null,
      startedAt: timestamp(asset.recording_start),
      endedAt: timestamp(asset.recording_end),
    }
  })
  return { id, uuid: required(row.uuid), title: string(row.topic), startedAt: timestamp(row.start_time), assets }
}
export class ZoomRecordings {
  readonly remote: ZoomRemote
  constructor(tokens: Pick<TokenManager, "tokens">, fetcher: typeof fetch, options: RemoteOptions = {}) {
    this.remote = new ZoomRemote(tokens, fetcher, options)
  }
  async list(options: RecordingRange): Promise<RecordingMeeting[]> {
    const dates = [options.from, options.to].map((date) => {
      const instant = Date.parse(`${date}T00:00:00Z`)
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(instant) ||
        new Date(instant).toISOString().slice(0, 10) !== date
      )
        throw new ZoomError("validation_error", "recording dates must be valid YYYY-MM-DD dates")
      return instant
    })
    const difference = (dates[1] ?? 0) - (dates[0] ?? 0)
    if (difference < 0 || difference > 31 * 86400000)
      throw new ZoomError("validation_error", "recording date range must be ordered and at most one month")
    const signal = operationSignal(options.signal)
    const query = new URLSearchParams({ from: options.from, to: options.to, page_size: "100" })
    const seen = new Set<string>()
    const meetings = new Map<string, RecordingMeeting>()
    for (;;) {
      const body = await this.remote.request(
        `/users/me/recordings?${query}`,
        "cloud_recording:read:list_user_recordings",
        { signal },
      )
      if (!Array.isArray(body.meetings))
        throw new ZoomError("invalid_response", "Zoom returned an invalid recording list")
      for (const value of body.meetings) {
        const item = meeting(value)
        const previous = meetings.get(item.uuid)
        if (previous && JSON.stringify(previous) !== JSON.stringify(item))
          throw new ZoomError("invalid_response", "Zoom returned conflicting recording occurrences")
        meetings.set(item.uuid, item)
      }
      const next = string(body.next_page_token)
      if (!next) return [...meetings.values()]
      if (seen.has(next)) throw new ZoomError("invalid_response", "Zoom repeated a pagination token")
      seen.add(next)
      query.set("next_page_token", next)
    }
  }
  private async details(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ meeting: RecordingMeeting; urls: Map<string, string> }> {
    if (!id.trim()) throw new ZoomError("validation_error", "recording meeting id is required")
    const body = await this.remote.request(
      `/meetings/${encodeUuid(id)}/recordings`,
      "cloud_recording:read:list_recording_files",
      { ...(signal ? { signal } : {}) },
    )
    const item = meeting(body)
    const rows = [
      ...(body.recording_files as unknown[]),
      ...(Array.isArray(body.participant_audio_files) ? body.participant_audio_files : []),
    ]
    const urls = new Map(
      rows.map((value) => {
        const row = object(value)
        return [string(row.id) ?? "", string(row.download_url) ?? ""]
      }),
    )
    return { meeting: item, urls }
  }
  async show(id: string, options: { signal?: AbortSignal } = {}): Promise<RecordingMeeting> {
    return (await this.details(id, options.signal)).meeting
  }
  async download(id: string, options: DownloadOptions): Promise<ArchiveReport> {
    const signal = operationSignal(options.signal)
    const details = await this.details(id, signal)
    return archiveRecording(this.remote, details.meeting, details.urls, { ...options, signal })
  }
}

export type {
  ArchivedFile,
  ArchiveLockInfo,
  ArchiveManifest,
  ArchiveReport,
  ArchiveVerification,
  DownloadOptions,
} from "./recording-archive.js"
export { inspectArchive, inspectArchiveLocks, recoverArchiveLocks, verifyArchive } from "./recording-archive.js"

export interface ZoomProfile {
  id: string
  email: string | null
  displayName: string | null
}
export const getZoomProfile = async (
  tokens: Pick<TokenManager, "tokens">,
  fetcher: typeof fetch,
  options: { signal?: AbortSignal } = {},
): Promise<ZoomProfile> => {
  const body = await new ZoomRemote(tokens, fetcher).request("/users/me", "user:read:user", options)
  return { id: required(body.id), email: string(body.email), displayName: string(body.display_name) }
}
