import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { CliError } from "@wirecat/cli-base"
import {
  type ImportFile,
  type MeetingSource,
  type ParticipantInput,
  parseTranscriptText,
  parseVtt,
  type SourceMeeting,
} from "@wirecat/cli-core/meetings"
import { TRANSCRIPT_MAX_BYTES } from "./api.js"
import { filesZone, type ZoomConfig } from "./config.js"

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
    throw new CliError("validation_error", "transcript filename contains an invalid date or time")
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
    throw new CliError("validation_error", "expected a valid IANA timezone")
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
    throw new CliError(
      "validation_error",
      "transcript filename time is ambiguous or nonexistent in the selected timezone",
    )
  return [...possibilities][0] ?? target
}
const FILE_NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_(.+)\.(vtt|txt)$/i
const isText = (name: string): boolean => /\.txt$/i.test(name)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `Mar 4, 2026 10:30 AM`, as the Zoom web portal shows a start: the wall clock of the zone the files were made in. */
const headerStart = (date: string | null, timezone: string): number | null => {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) ([AP]M)$/.exec(date ?? "")
  const month = MONTHS.indexOf(match?.[1] ?? "") + 1
  if (!match || month === 0) return null
  const [, , day, year, hour, minute, half] = match
  return localTimestamp(
    Number(year),
    month,
    Number(day),
    (Number(hour) % 12) + (half === "PM" ? 12 : 0),
    Number(minute),
    timezone,
  )
}

export const fileMeeting = (name: string, timezone = "UTC"): SourceMeeting => {
  const match = FILE_NAME.exec(basename(name))
  if (!match) throw new CliError("validation_error", "expected a transcript named YYYY-MM-DD_HHMM_topic.vtt or .txt")
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
/**
 * A `.txt` header names the meeting, its start, its Zoom meeting id and who spoke. The id is the series key the API
 * uses, so the file's copy and the API's copy of one occurrence become one record. A speaker is a participant of
 * this meeting only, keyed by name: a name alone never stands for the same person in another meeting.
 */
const textHeader = (file: DownloadedFile, accountId: number, occurrenceId: string, timezone: string) => {
  if (!isText(file.name)) return undefined
  const { header } = parseTranscriptText(file.content)
  const participants = header.speakers.map(
    (name, position): ParticipantInput => ({
      identity: {
        provider: "zoom",
        externalId: `name:${name}@${accountId}/${occurrenceId}:${position}`,
        name,
        metadata: null,
        associatePerson: false,
      },
      displayName: name,
      email: null,
      role: null,
      joinedAt: null,
      leftAt: null,
      durationMs: null,
      sessions: null,
      externalId: null,
      metadata: null,
    }),
  )
  const meetingId = header.meetingId?.replace(/\s/g, "")
  return {
    title: header.title,
    startedAt: headerStart(header.date, timezone),
    seriesId: meetingId && /^\d+$/.test(meetingId) ? meetingId : null,
    participants,
  }
}

export const importFile = (file: DownloadedFile, accountId: number, timezone = "UTC"): ImportFile => {
  const source = fileMeeting(file.name, timezone)
  const header = textHeader(file, accountId, source.occurrence.id, timezone)
  const title = header?.title ?? source.occurrence.title
  return {
    content: file.content,
    source: "file",
    ...(header ? { format: "text" as const, participants: header.participants } : {}),
    meeting: {
      accountId,
      externalId: source.occurrence.id,
      title,
      description: null,
      location: null,
      joinUrl: null,
      startedAt: header?.startedAt ?? Date.parse(source.occurrence.startedAt),
      endedAt: null,
      durationMs: null,
      timezone,
      hostIdentityId: null,
      participantsCount: null,
      metadata: null,
      deletedAt: null,
      series: {
        externalId: header?.seriesId ?? source.occurrence.seriesId,
        title: header?.title ?? source.series?.title ?? null,
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
    // A .txt and a .vtt of one meeting are two copies; the .txt also carries the header.
    if (existing && isText(existing.file.name) !== isText(file.name)) {
      if (isText(file.name)) result.set(meeting.occurrence.id, { meeting, file })
      continue
    }
    if (existing && existing.file.content !== file.content)
      throw new CliError("validation_error", "conflicting transcript files have the same occurrence key")
    if (!existing) result.set(meeting.occurrence.id, { meeting, file })
  }
  return result
}
export const validateDownloadedFiles = (files: DownloadedFile[], timezone = "UTC"): DownloadedFile[] =>
  [...indexDownloadedFiles(files, timezone).values()].map(({ file }) => file)
/** Every file is held in memory until the import ends. */
export const FOLDER_MAX_FILES = 10_000

export const readDownloadedFiles = async (folder: string): Promise<DownloadedFile[]> => {
  const listing = await readdir(folder, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new CliError("not_found", `folder not found: ${folder}`)
    if (error.code === "ENOTDIR") throw new CliError("validation_error", `not a folder: ${folder}`)
    if (error.code === "EACCES" || error.code === "EPERM")
      throw new CliError("permission_error", `cannot read folder: ${folder}`)
    throw error
  })
  const entries = listing
    // Any .vtt is a transcript and a misnamed one is an error; a .txt is one only when named like one.
    .filter(
      (entry) => entry.isFile() && (/\.vtt$/i.test(entry.name) || (isText(entry.name) && FILE_NAME.test(entry.name))),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  if (entries.length > FOLDER_MAX_FILES)
    throw new CliError(
      "validation_error",
      `the folder holds ${entries.length} transcript files and zm reads at most ${FOLDER_MAX_FILES} — move some into another folder`,
    )
  const files: DownloadedFile[] = []
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if ((await stat(path)).size > TRANSCRIPT_MAX_BYTES)
      throw new CliError(
        "validation_error",
        `${entry.name} is larger than ${TRANSCRIPT_MAX_BYTES / 1024 ** 2} MiB, the most zm reads from one transcript`,
      )
    files.push({ name: entry.name, content: await readFile(path, "utf8") })
  }
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
    if (!Number.isFinite(lower)) throw new CliError("validation_error", "expected an ISO since timestamp")
    return [...this.index().values()]
      .map(({ meeting }) => meeting)
      .filter((m) => Date.parse(m.occurrence.startedAt) >= lower)
  }
  async transcript(id: string) {
    const file = this.index().get(id)?.file
    if (!file) return null
    return isText(file.name) ? parseTranscriptText(file.content).lines : parseVtt(file.content)
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

/** What `meetings import --help` adds: the names zm reads and the zone it reads their time in. */
export const fileNamesHelp = (config: () => Pick<ZoomConfig, "filesTimezone">): string => {
  let zone: string
  try {
    zone = config().filesTimezone
      ? `files.timezone, now ${filesZone(config())}`
      : `this computer's zone, now ${filesZone(config())}`
  } catch {
    zone = "files.timezone, else this computer's zone"
  }
  return `Files: YYYY-MM-DD_HHMM_topic.vtt, and YYYY-MM-DD_HHMM_topic.txt with a header (Встреча:, Дата:, Zoom ID:, Говорят:).
The time in a file name and in Дата: is read in ${zone}; set another with
zm config set files.timezone <IANA zone>. Times are stored in UTC, and the import names the zone it used.`
}
