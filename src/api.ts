import { CliError, isCliError } from "@wirecat/cli-base"
import { statusToCode } from "@wirecat/cli-base/http"
import {
  type JsonValue,
  type MeetingSource,
  parseVtt,
  type SourceMeeting,
  type SourceParticipant,
  type SummaryContent,
} from "@wirecat/cli-core/meetings"
import { number, object, string, withIssue, ZoneAssumptions, zoomTime } from "./errors.js"
import { type RemoteOptions, ZoomRemote } from "./remote-http.js"
import type { TokenManager } from "./tokens.js"

/** A mislabeled HTML login page must not become an empty saved transcript. */
export const TRANSCRIPT_MAX_BYTES = 10 * 1024 * 1024

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
const requiredString = (value: unknown): string => {
  const text = string(value)
  if (text === null) throw new CliError("invalid_response", "Zoom response is missing a required field")
  return text
}
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
  private async instances(seriesId: string): Promise<Record<string, unknown>[]> {
    let body: Record<string, unknown> | null
    try {
      body = await this.request(
        `/past_meetings/${encodeURIComponent(seriesId)}/instances`,
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
    for (const row of series) {
      if (!(string(row.id) !== null || (typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0)))
        throw new CliError("invalid_response", "Zoom meeting is missing its series id")
      const seriesId = String(row.id)
      const recurring = row.type === 3 || row.type === 8
      const instances = await this.instances(seriesId)
      for (const instance of instances) {
        const doubt = { zoneless: false }
        const startedAt = this.time(instance.start_time, doubt)
        const id = requiredString(instance.uuid)
        if (startedAt === null) throw new CliError("invalid_response", "Zoom occurrence is missing its start time")
        if (startedAt < lower || seen.has(id)) continue
        seen.add(id)
        const rawDuration = recurring ? null : number(row.duration)
        const end = rawDuration !== null && rawDuration >= 0 ? startedAt + rawDuration * 60000 : Number.NaN
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
    }
    return meetings
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
    const url = requiredString(body.download_url)
    const tokens = await this.tokens.tokens()
    // One deadline covers every redirect and the streamed body.
    const signal = AbortSignal.timeout(30000)
    const response = await this.remote.download(url, {
      accessToken: tokens.accessToken,
      signal,
      what: "transcript",
      unreachable: () => new CliError("provider_error", "Transcript download could not be completed"),
    })
    if (!response.ok)
      throw new CliError(statusToCode(response.status), `Transcript download failed (HTTP ${response.status})`)
    const maxBytes = TRANSCRIPT_MAX_BYTES
    const reader = response.body?.getReader()
    if (!reader) throw new CliError("invalid_response", "Zoom returned an invalid transcript")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          throw new CliError("invalid_response", "Zoom transcript exceeds the download size limit")
        }
        chunks.push(value)
      }
    } catch (error) {
      if (isCliError(error)) throw error
      throw new CliError("provider_error", "Transcript download could not be completed")
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const content = new TextDecoder().decode(bytes)
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
  async chat() {
    return null
  }
  async files() {
    return null
  }
}
