import { CliError, isCliError } from "@wirecat/cli-base"
import { statusToCode } from "@wirecat/cli-base/http"
import {
  type FoundMeeting,
  type FoundMeetings,
  type FullMeeting,
  type JsonValue,
  type MeetingFinds,
  type MeetingSource,
  type MeetingTerm,
  type MeetingWindow,
  parseVtt,
  type SourceChatLine,
  type SourceMeeting,
  type SourceParticipant,
  type SummaryContent,
} from "@wirecat/cli-core/meetings"
import { parseZoomChat } from "./chat-file.js"
import { number, object, string, withIssue, ZoneAssumptions, zoomTime } from "./errors.js"
import { type RemoteOptions, ZoomRemote } from "./remote-http.js"
import type { TokenManager } from "./tokens.js"

/** A mislabeled HTML login page must not become an empty saved transcript. */
export const TRANSCRIPT_MAX_BYTES = 100 * 1024 * 1024

const json = (value: unknown): JsonValue => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(json)
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, json(item)]))
  return null
}
const extras = (row: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !keys.includes(key))
      .map(([key, value]) => [key, json(value)]),
  )
export const encodeUuid = (uuid: string): string =>
  uuid.startsWith("/") || uuid.includes("//") ? encodeURIComponent(encodeURIComponent(uuid)) : encodeURIComponent(uuid)
interface Doubt {
  zoneless: boolean
}
const seriesIdOf = (row: Record<string, unknown>): string => {
  if (!(string(row.id) !== null || (typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0)))
    throw new CliError("invalid_response", "Zoom meeting is missing its series id")
  return String(row.id)
}
const requiredString = (value: unknown): string => {
  const text = string(value)
  if (text === null) throw new CliError("invalid_response", "Zoom response is missing a required field")
  return text
}
/**
 * Zoom gives a meeting that has not run no instance uuid, and its next run gets a new one, so an upcoming meeting
 * listed live would be a second row beside the one sync writes. `meetings scheduled` lists those.
 */
const PAST_MEETING = "meeting:read:past_meeting"

const DAY = 86_400_000
// Zoom recommends a month or less for past instances, lists 6 months of past meetings, and takes 300 per page.
const FIND_SPAN = 30 * DAY
const FIND_REACH = 183 * DAY
const FIND_PAGE = 300
const FIND_SERIES = 20
interface FindCursor {
  floor: number
  end: number
  token: string | null
  skip: number
}
const findCursorOf = (cursor: string): FindCursor => {
  let value: unknown
  try {
    value = JSON.parse(cursor)
  } catch {
    throw new CliError("validation_error", "this Zoom page cursor is not one zm gave")
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CliError("validation_error", "this Zoom page cursor is not one zm gave")
  const row = value as Record<string, unknown>
  const whole = [row.floor, row.end, row.skip].every((value) => Number.isSafeInteger(value))
  if (!whole || (row.token !== null && !string(row.token)))
    throw new CliError("validation_error", "this Zoom page cursor is not one zm gave")
  return {
    floor: row.floor as number,
    end: row.end as number,
    token: (row.token as string | null) ?? null,
    skip: row.skip as number,
  }
}
/** Zoom's `from`/`to` are whole days, read in `timezone`; the exact window is applied to each occurrence. */
const zoomRange = (start: number, end: number) => ({
  from: new Date(start).toISOString().slice(0, 10),
  to: new Date(end).toISOString().slice(0, 10),
  timezone: "UTC",
})
export const ZOOM_FINDS: MeetingFinds = Object.freeze({ fields: {}, upcoming: false })

export class ZoomApiSource implements MeetingSource {
  readonly provider = "zoom"
  readonly transcriptFormat = "vtt"
  readonly name = "api"
  private readonly remote: ZoomRemote
  constructor(
    private readonly tokens: TokenManager,
    fetcher: typeof fetch,
    options: RemoteOptions = {},
    readonly zones = new ZoneAssumptions(),
  ) {
    this.remote = new ZoomRemote(tokens, fetcher, options)
  }
  private time(value: unknown, doubt: Doubt): number | null {
    const text = string(value)
    if (text === null) return null
    const { time, zone } = zoomTime(text, "Zoom returned an invalid timestamp")
    if (zone !== null) {
      doubt.zoneless = true
      this.zones.add(zone)
    }
    return time
  }
  private request(path: string, scope: string, missingCode?: number) {
    return missingCode === undefined
      ? this.remote.request(path, scope)
      : this.remote.requestOptional(path, scope, missingCode)
  }
  private async pages(path: string, key: string, scope: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = []
    const seen = new Set<string>()
    let next = ""
    do {
      const query = new URLSearchParams({ page_size: "100", ...(next ? { next_page_token: next } : {}) })
      const body = await this.request(`${path}${path.includes("?") ? "&" : "?"}${query}`, scope)
      if (!body || !Array.isArray(body[key])) throw new CliError("invalid_response", "Zoom returned an invalid list")
      for (const row of body[key]) rows.push(object(row))
      next = string(body.next_page_token) ?? ""
      if (next && seen.has(next)) throw new CliError("invalid_response", "Zoom repeated a pagination token")
      seen.add(next)
    } while (next)
    return rows
  }
  // A listed row's uuid is the meeting's, not the instance that ran, for every type: participants,
  // transcript and summary answer only for the instance uuid. This runs before the pull loop's
  // per-meeting guard, so a series Zoom no longer knows must not fail the whole sync.
  private async instances(seriesId: string, range?: URLSearchParams): Promise<Record<string, unknown>[]> {
    let body: Record<string, unknown> | null
    try {
      body = await this.request(
        `/past_meetings/${encodeURIComponent(seriesId)}/instances${range ? `?${range}` : ""}`,
        "meeting:read:list_past_instances",
      )
    } catch (error) {
      if (isCliError(error) && error.code === statusToCode(404)) return []
      throw error
    }
    if (!body || !Array.isArray(body.meetings))
      throw new CliError("invalid_response", "Zoom returned invalid occurrences")
    return body.meetings.map(object)
  }
  /** A listed series' occurrences that ran, each by its instance uuid, the id `meetings()`, `find` and `get` share. */
  private occurrences(
    row: Record<string, unknown>,
    instances: Record<string, unknown>[],
    keep: (startedAt: number) => boolean,
    seen: Set<string>,
  ): SourceMeeting[] {
    const seriesId = seriesIdOf(row)
    const recurring = row.type === 3 || row.type === 8
    const meetings: SourceMeeting[] = []
    for (const instance of instances) {
      const doubt = { zoneless: false }
      const startedAt = this.time(instance.start_time, doubt)
      const id = requiredString(instance.uuid)
      if (startedAt === null) throw new CliError("invalid_response", "Zoom occurrence is missing its start time")
      if (!keep(startedAt) || seen.has(id)) continue
      seen.add(id)
      const ended = instance.end_time === undefined ? null : this.time(instance.end_time, doubt)
      const rawDuration = recurring ? null : number(row.duration)
      const end = ended ?? (rawDuration !== null && rawDuration >= 0 ? startedAt + rawDuration * 60000 : Number.NaN)
      const endedAt = Number.isFinite(end) && Math.abs(end) <= 8640000000000000 ? new Date(end).toISOString() : null
      meetings.push({
        series: {
          id: seriesId,
          provider: "zoom",
          title: string(row.topic),
          kind: recurring ? "recurring" : row.type === 1 ? "instant" : "scheduled",
          joinUrl: string(row.join_url) ?? undefined,
          recurrence: json(row.recurrence),
        },
        occurrence: {
          id,
          seriesId,
          title: string(row.topic),
          startedAt: new Date(startedAt).toISOString(),
          endedAt,
        },
        description: string(row.agenda),
        joinUrl: string(row.join_url),
        timezone: string(row.timezone),
        metadata: withIssue(
          extras(row, [
            "id",
            "uuid",
            "topic",
            "type",
            "start_time",
            "end_time",
            "duration",
            "join_url",
            "timezone",
            "agenda",
            "recurrence",
          ]),
          doubt.zoneless,
        ),
      })
    }
    return meetings
  }
  async meetings(since: string): Promise<SourceMeeting[]> {
    const lower = Date.parse(since)
    if (!Number.isFinite(lower)) throw new CliError("validation_error", "expected an ISO since timestamp")
    const series = await this.pages(
      "/users/me/meetings?type=previous_meetings",
      "meetings",
      "meeting:read:list_meetings",
    )
    const meetings: SourceMeeting[] = []
    const seen = new Set<string>()
    for (const row of series)
      for (const meeting of this.occurrences(row, await this.instances(seriesIdOf(row)), (at) => at >= lower, seen))
        meetings.push(meeting)
    return meetings
  }
  readonly finds = ZOOM_FINDS
  /**
   * One stretch of at most `FIND_SPAN` of `window`, newest first, and the instances of at most `FIND_SERIES` of its
   * series: 1 + `FIND_SERIES` requests. The cursor carries on in the same stretch, then the one before it; without a
   * lower bound, back as far as Zoom lists (`FIND_REACH`). cli-core's page cap then says the answer is not complete.
   */
  async find(window: MeetingWindow, _terms: readonly MeetingTerm[], cursor: string | null): Promise<FoundMeetings> {
    const at = cursor === null ? undefined : findCursorOf(cursor)
    const end = at?.end ?? window.to ?? Date.now()
    const floor = at?.floor ?? window.from ?? end - FIND_REACH
    const start = Math.max(floor, end - FIND_SPAN)
    const range = zoomRange(start, end)
    const query = new URLSearchParams({ type: "previous_meetings", page_size: String(FIND_PAGE), ...range })
    if (at?.token) query.set("next_page_token", at.token)
    const body = await this.request(`/users/me/meetings?${query}`, "meeting:read:list_meetings")
    if (!body || !Array.isArray(body.meetings)) throw new CliError("invalid_response", "Zoom returned an invalid list")
    const rows = body.meetings.map(object)
    const skip = at?.skip ?? 0
    const taken = rows.slice(skip, skip + FIND_SERIES)
    const inWindow = (time: number) =>
      (window.from === undefined || time >= window.from) && (window.to === undefined || time <= window.to)
    const seen = new Set<string>()
    const meetings: FoundMeeting[] = []
    const ranges = new URLSearchParams({ from: range.from, to: range.to })
    for (const row of taken)
      for (const meeting of this.occurrences(row, await this.instances(seriesIdOf(row), ranges), inWindow, seen))
        meetings.push({ meeting })
    const token = string(body.next_page_token) || null
    if (token !== null && token === at?.token)
      throw new CliError("invalid_response", "Zoom repeated a pagination token")
    const next: FindCursor | null =
      skip + taken.length < rows.length
        ? { floor, end, token: at?.token ?? null, skip: skip + taken.length }
        : token !== null
          ? { floor, end, token, skip: 0 }
          : start > floor
            ? { floor, end: start - 1, token: null, skip: 0 }
            : null
    return { meetings, next: next && JSON.stringify(next) }
  }
  /**
   * One meeting that ran, by its instance uuid or by its meeting number (then its latest instance): always answered
   * by the instance uuid, so `show <number>` keeps the row sync writes. `null` for one that never ran.
   */
  async get(id: string): Promise<FullMeeting | null> {
    const given = id.trim()
    if (!given) throw new CliError("validation_error", "name a Zoom meeting by its uuid or number")
    // A refusal, not a failure: `meetings show` then says why instead of "not found" for a meeting not stored yet.
    const { scopes } = await this.tokens.tokens()
    if (!["", ":admin", ":master"].some((grant) => scopes.includes(`${PAST_MEETING}${grant}`)))
      throw new CliError(
        "permission_error",
        `Zoom scope ${PAST_MEETING} is missing; add it to the app and run zm <profile> session start again`,
      )
    const body = await this.request(`/past_meetings/${encodeUuid(given)}`, PAST_MEETING, 3001)
    if (!body) return null
    const [found] = this.occurrences(body, [body], () => true, new Set())
    if (!found) return null
    // A past meeting's answer has no join link or recurrence: a series here would blank the stored one, and a sync
    // writes it from the meeting list.
    const meeting = { ...found, series: null }
    const uuid = meeting.occurrence.id
    const [participants, transcript] = await Promise.all([this.participants(uuid), this.transcriptOnShow(uuid)])
    return { meeting, participants, ...(transcript === undefined ? {} : { transcript }) }
  }
  /** A transcript Zoom is still making is left unread here, so `show` keeps the meeting and a later sync reads it. */
  private async transcriptOnShow(uuid: string) {
    try {
      return await this.transcript(uuid)
    } catch (error) {
      if (isCliError(error) && error.code === "provider_error") return undefined
      throw error
    }
  }
  async participants(id: string): Promise<SourceParticipant[]> {
    const rows = await this.pages(
      `/past_meetings/${encodeUuid(id)}/participants`,
      "participants",
      "meeting:read:list_past_participants",
    )
    const participants = new Map<string, SourceParticipant>()
    const seenSessions = new Set<string>()
    for (const [position, row] of rows.entries()) {
      const stableId = string(row.id)
      const email = string(row.user_email)
      const registrant = string(row.registrant_id)
      const key = stableId
        ? `id:${stableId}`
        : email
          ? `email:${email.toLowerCase()}`
          : registrant
            ? `registrant:${registrant}`
            : `unknown:${position}`
      const doubt = { zoneless: false }
      const joinedAt = this.time(row.join_time, doubt)
      const leftAt = this.time(row.leave_time, doubt)
      const rawDuration = number(row.duration)
      const duration =
        rawDuration !== null && rawDuration >= 0 && Number.isFinite(rawDuration * 1000) ? rawDuration : null
      // Only stable identities with a concrete session id can be deduplicated safely.
      const sessionId = string(row.user_id)
      if (key !== `unknown:${position}` && sessionId) {
        const fingerprint = JSON.stringify([key, sessionId, joinedAt, leftAt, duration])
        if (seenSessions.has(fingerprint)) continue
        seenSessions.add(fingerprint)
      }
      const session = {
        joinedAt,
        leftAt,
        durationMs: duration === null ? null : duration * 1000,
        userId: string(row.user_id),
        displayName: string(row.name),
      }
      const existing = participants.get(key)
      if (existing) {
        if (joinedAt !== null) existing.joinedAt = Math.min(existing.joinedAt ?? joinedAt, joinedAt)
        if (leftAt !== null) existing.leftAt = Math.max(existing.leftAt ?? leftAt, leftAt)
        if (duration !== null) existing.durationMs = (existing.durationMs ?? 0) + duration * 1000
        if (Array.isArray(existing.sessions)) existing.sessions.push(session)
        if (doubt.zoneless) existing.metadata = withIssue(existing.metadata ?? {}, true)
      } else
        participants.set(key, {
          identityExternalId: stableId,
          email,
          externalId: registrant,
          displayName: string(row.name),
          role: string(row.role),
          joinedAt,
          leftAt,
          durationMs: duration === null ? null : duration * 1000,
          sessions: [session],
          metadata: withIssue(
            extras(row, ["id", "name", "user_email", "registrant_id", "join_time", "leave_time", "duration", "role"]),
            doubt.zoneless,
          ),
        })
    }
    return [...participants.values()]
  }
  private async downloadText(url: string, what: "transcript" | "chat"): Promise<string> {
    const label = what === "chat" ? "Chat" : "Transcript"
    const tokens = await this.tokens.tokens()
    // One deadline covers every redirect and the streamed body.
    const signal = AbortSignal.timeout(30000)
    const response = await this.remote.download(url, {
      accessToken: tokens.accessToken,
      signal,
      what,
      unreachable: () => new CliError("provider_error", `${label} download could not be completed`),
    })
    if (!response.ok)
      throw new CliError(statusToCode(response.status), `${label} download failed (HTTP ${response.status})`)
    const maxBytes = TRANSCRIPT_MAX_BYTES
    const reader = response.body?.getReader()
    if (!reader) throw new CliError("invalid_response", `Zoom returned an invalid ${what}`)
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          throw new CliError("invalid_response", `Zoom ${what} exceeds the download size limit`)
        }
        chunks.push(value)
      }
    } catch (error) {
      if (isCliError(error)) throw error
      throw new CliError("provider_error", `${label} download could not be completed`)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(bytes)
  }
  async transcript(id: string) {
    const body = await this.request(
      `/meetings/${encodeUuid(id)}/transcript`,
      "cloud_recording:read:meeting_transcript",
      3322,
    )
    if (!body) return null
    if (body.can_download === false) {
      // A failed read keeps the meeting due, so the next sync asks again.
      if (body.download_restriction_reason === "NOT_READY")
        throw new CliError("provider_error", "Zoom has not finished this transcript yet; a later sync reads it")
      return null
    }
    const content = await this.downloadText(requiredString(body.download_url), "transcript")
    try {
      return parseVtt(content)
    } catch {
      throw new CliError("invalid_response", "Zoom returned an invalid transcript")
    }
  }

  async summary(id: string): Promise<SummaryContent | null> {
    const body = await this.request(`/meetings/${encodeUuid(id)}/meeting_summary`, "meeting:read:summary", 3001)
    if (!body) return null
    const doubt = { zoneless: false }
    const edited = body.edited_summary && typeof body.edited_summary === "object" ? object(body.edited_summary) : null
    const details = Array.isArray(body.summary_details) ? body.summary_details.map(object) : []
    const steps = edited?.next_steps ?? body.next_steps
    const content = typeof body.summary_content === "string" ? body.summary_content : null
    const editedDetails = typeof edited?.summary_details === "string" ? edited.summary_details : null
    const editedOverview = typeof edited?.summary_overview === "string" ? edited.summary_overview : null
    return {
      source: "zoom-ai",
      content: content ?? editedDetails,
      docUrl: string(body.summary_doc_url),
      externalCreatedAt: this.time(body.summary_created_time, doubt),
      externalUpdatedAt: this.time(body.summary_last_modified_time, doubt),
      metadata: withIssue(
        extras(body, [
          "summary_content",
          "summary_title",
          "summary_overview",
          "summary_details",
          "next_steps",
          "edited_summary",
          "summary_doc_url",
          "summary_created_time",
          "summary_last_modified_time",
        ]),
        doubt.zoneless,
      ),
      title: string(body.summary_title),
      overview: editedOverview ?? string(body.summary_overview),
      sections:
        content !== null || editedDetails !== null
          ? []
          : details.map((part) => ({ label: string(part.label) ?? "", text: string(part.summary) ?? "" })),
      nextSteps:
        content !== null ? [] : Array.isArray(steps) ? steps.filter((s): s is string => typeof s === "string") : [],
    }
  }
  /** The chat Zoom saved with the cloud recording; a meeting without one, or a login without the scope, has none. */
  async chat(id: string): Promise<SourceChatLine[] | null> {
    const scope = "cloud_recording:read:list_recording_files"
    const granted = (await this.tokens.tokens()).scopes
    if (![scope, `${scope}:admin`].some((grant) => granted.includes(grant))) return null
    const body = await this.request(`/meetings/${encodeUuid(id)}/recordings`, scope, 3301)
    if (!body || !Array.isArray(body.recording_files)) return null
    const file = body.recording_files
      .map(object)
      .find((row) => row.file_type === "CHAT" && row.status === "completed" && string(row.download_url) !== null)
    if (!file) return null
    const start = this.time(file.recording_start ?? body.start_time, { zoneless: false })
    if (start === null) throw new CliError("invalid_response", "Zoom chat file is missing its start time")
    return parseZoomChat(await this.downloadText(requiredString(file.download_url), "chat"), start)
  }
  async files() {
    return null
  }
}
