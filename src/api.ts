import {
  type JsonValue,
  type MeetingSource,
  parseVtt,
  type SourceMeeting,
  type SourceParticipant,
  type SummaryContent,
} from "@wirecat/cli-meetings"
import { number, object, string, ZoomError } from "./errors.js"
import type { TokenManager } from "./tokens.js"

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
const time = (value: unknown): number | null => {
  const text = string(value)
  if (text === null) return null
  const result = Date.parse(text)
  if (!Number.isFinite(result)) throw new ZoomError("invalid_response", "Zoom returned an invalid timestamp")
  return result
}
const requiredString = (value: unknown): string => {
  const text = string(value)
  if (text === null) throw new ZoomError("invalid_response", "Zoom response is missing a required field")
  return text
}
export class ZoomApiSource implements MeetingSource {
  readonly provider = "zoom"
  readonly name = "api"
  constructor(
    private readonly tokens: TokenManager,
    private readonly fetcher: typeof fetch,
  ) {}
  private async request(path: string, scope: string, missingCode?: number) {
    const tokens = await this.tokens.tokens()
    if (!tokens.scopes.includes(scope) && !tokens.scopes.includes(`${scope}:admin`))
      throw new ZoomError(
        "authentication_error",
        `Zoom scope ${scope} is missing; add it to the app and run zm login again`,
      )
    const response = await this.fetcher(`https://api.zoom.us/v2${path}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(30000),
    })
    const body = object(await response.json())
    if (body.code === 4711)
      throw new ZoomError(
        "authentication_error",
        `Zoom scope ${scope} is missing; add it to the app and run zm login again`,
      )
    if (!response.ok) {
      if (response.status === 404 && body.code === missingCode) return null
      throw new ZoomError(
        response.status === 401 ? "authentication_error" : "provider_error",
        `Zoom request failed (HTTP ${response.status}${typeof body.code === "number" ? `, code ${body.code}` : ""})`,
      )
    }
    return body
  }
  private async pages(path: string, key: string, scope: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = []
    const seen = new Set<string>()
    let next = ""
    do {
      const query = new URLSearchParams({ page_size: "100", ...(next ? { next_page_token: next } : {}) })
      const body = await this.request(`${path}${path.includes("?") ? "&" : "?"}${query}`, scope)
      if (!body || !Array.isArray(body[key])) throw new ZoomError("invalid_response", "Zoom returned an invalid list")
      rows.push(...body[key].map(object))
      next = string(body.next_page_token) ?? ""
      if (next && seen.has(next)) throw new ZoomError("invalid_response", "Zoom repeated a pagination token")
      seen.add(next)
    } while (next)
    return rows
  }
  async meetings(since: string): Promise<SourceMeeting[]> {
    const lower = Date.parse(since)
    if (!Number.isFinite(lower)) throw new ZoomError("validation_error", "expected an ISO since timestamp")
    const series = await this.pages(
      "/users/me/meetings?type=previous_meetings",
      "meetings",
      "meeting:read:list_meetings",
    )
    const meetings: SourceMeeting[] = []
    const seen = new Set<string>()
    for (const row of series) {
      if (!(typeof row.id === "string" || (typeof row.id === "number" && Number.isSafeInteger(row.id))))
        throw new ZoomError("invalid_response", "Zoom meeting is missing its series id")
      const seriesId = String(row.id)
      const recurring = row.type === 3 || row.type === 8
      let instances: Record<string, unknown>[] = [row]
      if (recurring) {
        const body = await this.request(
          `/past_meetings/${encodeURIComponent(seriesId)}/instances`,
          "meeting:read:list_past_instances",
        )
        if (!body || !Array.isArray(body.meetings))
          throw new ZoomError("invalid_response", "Zoom returned invalid occurrences")
        instances = body.meetings.map(object)
      }
      for (const instance of instances) {
        const startedAt = time(instance.start_time)
        const id = requiredString(instance.uuid)
        if (startedAt === null) throw new ZoomError("invalid_response", "Zoom occurrence is missing its start time")
        if (startedAt < lower || seen.has(id)) continue
        seen.add(id)
        const duration = recurring ? null : number(row.duration)
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
            endedAt: duration === null ? null : new Date(startedAt + duration * 60000).toISOString(),
          },
          description: string(row.agenda),
          joinUrl: string(row.join_url),
          timezone: string(row.timezone),
          metadata: extras(row, [
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
      const joinedAt = time(row.join_time)
      const leftAt = time(row.leave_time)
      const duration = number(row.duration)
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
          metadata: extras(row, [
            "id",
            "name",
            "user_email",
            "registrant_id",
            "join_time",
            "leave_time",
            "duration",
            "role",
          ]),
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
    const target = new URL(requiredString(body.download_url))
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      !/(^|\.)zoom\.(us|com)$/.test(target.hostname)
    )
      throw new ZoomError("invalid_response", "Zoom returned an unexpected transcript download host")
    const tokens = await this.tokens.tokens()
    const response = await this.fetcher(target, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new ZoomError("provider_error", `Transcript download failed (HTTP ${response.status})`)
    return parseVtt(await response.text())
  }
  async summary(id: string): Promise<SummaryContent | null> {
    const body = await this.request(`/meetings/${encodeUuid(id)}/meeting_summary`, "meeting:read:summary", 3001)
    if (!body) return null
    const edited = body.edited_summary && typeof body.edited_summary === "object" ? object(body.edited_summary) : null
    const details = Array.isArray(body.summary_details) ? body.summary_details.map(object) : []
    const steps = edited?.next_steps ?? body.next_steps
    const content = string(body.summary_content)
    return {
      source: "zoom-ai",
      content: content ?? string(edited?.summary_details),
      docUrl: string(body.summary_doc_url),
      externalCreatedAt: time(body.summary_created_time),
      externalUpdatedAt: time(body.summary_last_modified_time),
      metadata: extras(body, [
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
      title: string(body.summary_title),
      overview: string(edited?.summary_overview) ?? string(body.summary_overview),
      sections: content
        ? []
        : details.map((part) => ({ label: string(part.label) ?? "", text: string(part.summary) ?? "" })),
      nextSteps: content ? [] : Array.isArray(steps) ? steps.filter((s): s is string => typeof s === "string") : [],
    }
  }
  async chat() {
    return null
  }
  async files() {
    return null
  }
}
