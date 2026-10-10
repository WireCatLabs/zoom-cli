import { object, string, ZoomError } from "./errors.js"
import { required } from "./recordings.js"
import { operationSignal, type RemoteOptions, type RemoteRequest, ZoomRemote } from "./remote-http.js"
import type { TokenManager } from "./tokens.js"

export interface RemoteMeeting {
  id: string
  uuid: string | null
  title: string | null
  type: number | null
  startedAt: string | null
  durationMinutes: number | null
  timezone: string | null
  agenda: string | null
  joinUrl: string | null
}
export interface MeetingChange {
  topic?: string
  startTime?: string
  durationMinutes?: number
  timezone?: string
  agenda?: string
  type?: 1 | 2
}
export interface MutationOptions {
  apply?: boolean
  dryRun?: boolean
  signal?: AbortSignal
  occurrenceId?: string
}
export interface MeetingMutation {
  action: "create" | "update" | "cancel"
  applied: boolean
  request: { method: "POST" | "PATCH" | "DELETE"; path: string; body?: Record<string, unknown> }
  meeting?: RemoteMeeting
}
const idPath = (id: string) => {
  if (!/^[1-9]\d*$/.test(id)) throw new ZoomError("validation_error", "remote meeting id must be a positive numeric id")
  return `/meetings/${id}`
}
const normalized = (value: unknown): RemoteMeeting => {
  const row = object(value)
  const id = typeof row.id === "number" && Number.isSafeInteger(row.id) ? String(row.id) : required(row.id)
  idPath(id)
  return {
    id,
    uuid: string(row.uuid),
    title: string(row.topic),
    type: typeof row.type === "number" ? row.type : null,
    startedAt: string(row.start_time),
    durationMinutes:
      typeof row.duration === "number" && Number.isFinite(row.duration) && row.duration >= 0 ? row.duration : null,
    timezone: string(row.timezone),
    agenda: string(row.agenda),
    joinUrl: string(row.join_url),
  }
}
const changeBody = (change: MeetingChange, create: boolean): Record<string, unknown> => {
  if (
    !change ||
    Object.keys(change).some(
      (key) => !["topic", "startTime", "durationMinutes", "timezone", "agenda", "type"].includes(key),
    )
  )
    throw new ZoomError("validation_error", "unsupported meeting change field")
  const body: Record<string, unknown> = {}
  if (change.topic !== undefined) {
    if (!string(change.topic)) throw new ZoomError("validation_error", "meeting topic must be nonempty")
    body.topic = change.topic
  }
  if (create && !string(change.topic)) throw new ZoomError("validation_error", "meeting topic is required")
  if (change.startTime !== undefined) {
    if (
      typeof change.startTime !== "string" ||
      !/T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(change.startTime) ||
      !Number.isFinite(Date.parse(change.startTime))
    )
      throw new ZoomError("validation_error", "meeting start must be an ISO timestamp with a timezone")
    const date = change.startTime.slice(0, 10)
    const dateInstant = Date.parse(`${date}T00:00:00Z`)
    if (!Number.isFinite(dateInstant) || new Date(dateInstant).toISOString().slice(0, 10) !== date)
      throw new ZoomError("validation_error", "meeting start contains an invalid calendar date")
    body.start_time = new Date(change.startTime).toISOString()
  }
  if (change.durationMinutes !== undefined) {
    if (!Number.isSafeInteger(change.durationMinutes) || change.durationMinutes <= 0 || change.durationMinutes > 1440)
      throw new ZoomError("validation_error", "meeting duration must be an integer from 1 to 1440 minutes")
    body.duration = change.durationMinutes
  }
  if (change.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: change.timezone }).format()
    } catch {
      throw new ZoomError("validation_error", "meeting timezone must be a valid IANA timezone")
    }
    body.timezone = change.timezone
  }
  if (change.agenda !== undefined) {
    if (typeof change.agenda !== "string") throw new ZoomError("validation_error", "meeting agenda must be text")
    body.agenda = change.agenda
  }
  if (change.type !== undefined && change.type !== 1 && change.type !== 2)
    throw new ZoomError("validation_error", "only instant or scheduled meeting types are supported")
  if (create) {
    body.type = change.type ?? 2
    if (body.type === 2 && body.start_time === undefined)
      throw new ZoomError("validation_error", "scheduled meeting start is required")
  } else {
    if (change.type !== undefined) body.type = change.type
    if (Object.keys(body).length === 0)
      throw new ZoomError("validation_error", "at least one meeting change is required")
  }
  return body
}
export class ZoomRemoteMeetings {
  readonly remote: ZoomRemote
  constructor(tokens: Pick<TokenManager, "tokens">, fetcher: typeof fetch, options: RemoteOptions = {}) {
    this.remote = new ZoomRemote(tokens, fetcher, options)
  }
  async list(options: { signal?: AbortSignal } = {}): Promise<RemoteMeeting[]> {
    const signal = operationSignal(options.signal)
    const query = new URLSearchParams({ type: "upcoming", page_size: "100" })
    const seen = new Set<string>()
    const result = new Map<string, RemoteMeeting>()
    for (;;) {
      const body = await this.remote.request(`/users/me/meetings?${query}`, "meeting:read:list_meetings", { signal })
      if (!Array.isArray(body.meetings))
        throw new ZoomError("invalid_response", "Zoom returned an invalid meeting list")
      for (const row of body.meetings) {
        const item = normalized(row)
        result.set(item.id, item)
      }
      const next = string(body.next_page_token)
      if (!next) return [...result.values()]
      if (seen.has(next)) throw new ZoomError("invalid_response", "Zoom repeated a pagination token")
      seen.add(next)
      query.set("next_page_token", next)
    }
  }
  async show(id: string, options: { signal?: AbortSignal } = {}): Promise<RemoteMeeting> {
    return normalized(await this.remote.request(idPath(id), "meeting:read:meeting", options))
  }
  async invitation(id: string, options: { signal?: AbortSignal } = {}): Promise<{ id: string; invitation: string }> {
    const body = await this.remote.request(`${idPath(id)}/invitation`, "meeting:read:invitation", options)
    return { id, invitation: required(body.invitation) }
  }
  private async mutate(
    action: MeetingMutation["action"],
    request: MeetingMutation["request"],
    scope: string,
    options: MutationOptions,
  ): Promise<MeetingMutation> {
    const result: MeetingMutation = { action, applied: false, request }
    if (!options.apply || options.dryRun) return result
    const init: RemoteRequest = {
      method: request.method,
      ...(request.body ? { body: request.body } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    }
    const body = await this.remote.request(request.path, scope, init)
    result.applied = true
    if (action === "create") {
      try {
        result.meeting = normalized(body)
      } catch {
        throw new ZoomError(
          "outcome_unknown",
          "Zoom mutation returned incomplete meeting details; verify remote state before retrying",
        )
      }
    }
    return result
  }
  create(change: MeetingChange, options: MutationOptions = {}): Promise<MeetingMutation> {
    return this.mutate(
      "create",
      { method: "POST", path: "/users/me/meetings", body: changeBody(change, true) },
      "meeting:write:meeting",
      options,
    )
  }
  update(id: string, change: MeetingChange, options: MutationOptions = {}): Promise<MeetingMutation> {
    return this.mutate(
      "update",
      { method: "PATCH", path: idPath(id), body: changeBody(change, false) },
      "meeting:update:meeting",
      options,
    )
  }
  cancel(id: string, options: MutationOptions = {}): Promise<MeetingMutation> {
    const path = idPath(id)
    if (options.occurrenceId !== undefined && !string(options.occurrenceId))
      throw new ZoomError("validation_error", "occurrence id must be nonempty")
    const query = options.occurrenceId ? `?${new URLSearchParams({ occurrence_id: options.occurrenceId })}` : ""
    return this.mutate("cancel", { method: "DELETE", path: `${path}${query}` }, "meeting:delete:meeting", options)
  }
}
