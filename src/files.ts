import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { type ImportFile, type MeetingSource, parseVtt, type SourceMeeting } from "@wirecat/cli-core/meetings"
import { ZoomError } from "./errors.js"

export interface DownloadedFile {
  name: string
  content: string
}
const localTimestamp = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): number => {
  const target = Date.UTC(year, month - 1, day, hour, minute)
  const date = new Date(target)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    throw new ZoomError("validation_error", "transcript filename contains an invalid date or time")
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
  } catch {
    throw new ZoomError("validation_error", "expected a valid IANA timezone")
  }
  const wallTime = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]))
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    )
  }
  const possibilities = new Set<number>()
  for (const delta of [-86400000, 0, 86400000]) {
    const probe = target + delta
    const candidate = target - (wallTime(probe) - probe)
    if (wallTime(candidate) === target) possibilities.add(candidate)
  }
  if (possibilities.size !== 1)
    throw new ZoomError(
      "validation_error",
      "transcript filename time is ambiguous or nonexistent in the selected timezone",
    )
  return [...possibilities][0] ?? target
}
export const fileMeeting = (name: string, timezone = "UTC"): SourceMeeting => {
  const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_(.+)\.vtt$/i.exec(basename(name))
  if (!match) throw new ZoomError("validation_error", "expected a transcript named YYYY-MM-DD_HHMM_topic.vtt")
  const [, year, month, day, hour, minute, topic = ""] = match
  const startedAt = localTimestamp(Number(year), Number(month), Number(day), Number(hour), Number(minute), timezone)
  const slug = topic.normalize("NFC")
  const id = `file:${createHash("sha256").update(`${year}-${month}-${day}_${hour}${minute}_${slug}`).digest("hex")}`
  const seriesId = `file:${slug}`
  const title = slug.replace(/-/g, " ")
  return {
    series: { id: seriesId, provider: "zoom", title },
    occurrence: { id, seriesId, title, startedAt: new Date(startedAt).toISOString(), endedAt: null },
    timezone,
  }
}
export const importFile = (file: DownloadedFile, accountId: number, timezone = "UTC"): ImportFile => {
  const source = fileMeeting(file.name, timezone)
  return {
    content: file.content,
    source: "file",
    meeting: {
      accountId,
      externalId: source.occurrence.id,
      title: source.occurrence.title,
      description: null,
      location: null,
      joinUrl: null,
      startedAt: Date.parse(source.occurrence.startedAt),
      endedAt: null,
      durationMs: null,
      timezone,
      hostIdentityId: null,
      participantsCount: null,
      metadata: null,
      deletedAt: null,
      series: {
        externalId: source.occurrence.seriesId,
        title: source.series?.title ?? null,
        description: null,
        kind: null,
        recurrence: null,
        hostIdentityId: null,
        joinUrl: null,
        metadata: null,
        deletedAt: null,
      },
    },
  }
}
const indexDownloadedFiles = (
  files: DownloadedFile[],
  timezone: string,
): Map<string, { meeting: SourceMeeting; file: DownloadedFile }> => {
  const result = new Map<string, { meeting: SourceMeeting; file: DownloadedFile }>()
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const meeting = fileMeeting(file.name, timezone)
    const existing = result.get(meeting.occurrence.id)
    if (existing && existing.file.content !== file.content)
      throw new ZoomError("validation_error", "conflicting transcript files have the same occurrence key")
    if (!existing) result.set(meeting.occurrence.id, { meeting, file })
  }
  return result
}
export const validateDownloadedFiles = (files: DownloadedFile[], timezone = "UTC"): DownloadedFile[] =>
  [...indexDownloadedFiles(files, timezone).values()].map(({ file }) => file)
export const readDownloadedFiles = async (folder: string): Promise<DownloadedFile[]> => {
  const entries = await readdir(folder, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /\.vtt$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => ({ name: entry.name, content: await readFile(join(folder, entry.name), "utf8") })),
  )
  return validateDownloadedFiles(files)
}
export class FilesSource implements MeetingSource {
  readonly provider = "zoom"
  readonly transcriptFormat = "vtt"
  readonly name = "file"
  constructor(
    private readonly filesData: DownloadedFile[],
    private readonly timezone = "UTC",
  ) {}
  private indexed: Map<string, { meeting: SourceMeeting; file: DownloadedFile }> | undefined
  private index(): Map<string, { meeting: SourceMeeting; file: DownloadedFile }> {
    if (this.indexed) return this.indexed
    this.indexed = indexDownloadedFiles(this.filesData, this.timezone)
    return this.indexed
  }
  async meetings(since: string): Promise<SourceMeeting[]> {
    const lower = Date.parse(since)
    if (!Number.isFinite(lower)) throw new ZoomError("validation_error", "expected an ISO since timestamp")
    return [...this.index().values()]
      .map(({ meeting }) => meeting)
      .filter((m) => Date.parse(m.occurrence.startedAt) >= lower)
  }
  async transcript(id: string) {
    const file = this.index().get(id)?.file
    return file ? parseVtt(file.content) : null
  }
  async participants() {
    return null
  }
  async chat() {
    return null
  }
  async summary() {
    return null
  }
  async files() {
    return null
  }
}
