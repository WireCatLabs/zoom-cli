import {
  createMeetingManagement,
  dispatchMeetingMutation,
  type ManagedMeeting,
  type ManagedMeetingChange,
  validateMeetingChange,
} from "@wirecat/cli-messaging/meetings"
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
  if (change.type !== undefined && change.type !== 1 && change.type !== 2)
    throw new ZoomError("validation_error", "only instant or scheduled meeting types are supported")
  const neutral: ManagedMeetingChange = {
    ...(change.topic !== undefined ? { title: change.topic } : {}),
    ...(change.type !== undefined ? { kind: change.type === 1 ? "instant" : "scheduled" } : {}),
    ...(change.startTime !== undefined ? { startTime: change.startTime } : {}),
    ...(change.durationMinutes !== undefined ? { durationMinutes: change.durationMinutes } : {}),
    ...(change.timezone !== undefined ? { timezone: change.timezone } : {}),
    ...(change.agenda !== undefined ? { agenda: change.agenda } : {}),
  }
  const validated = validateMeetingChange(neutral, create)
  const body: Record<string, unknown> = {
    ...(validated.title !== undefined ? { topic: validated.title } : {}),
    ...(validated.kind !== undefined ? { type: validated.kind === "instant" ? 1 : 2 } : {}),
    ...(validated.startTime !== undefined ? { start_time: validated.startTime } : {}),
    ...(validated.durationMinutes !== undefined ? { duration: validated.durationMinutes } : {}),
    ...(validated.timezone !== undefined ? { timezone: validated.timezone } : {}),
    ...(validated.agenda !== undefined ? { agenda: validated.agenda } : {}),
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
    const outcome = await dispatchMeetingMutation(options, async (signal) => {
      const init: RemoteRequest = {
        method: request.method,
        ...(request.body ? { body: request.body } : {}),
        ...(signal ? { signal } : {}),
      }
      const body = await this.remote.request(request.path, scope, init)
      if (action === "create") {
        try {
          return normalized(body)
        } catch {
          throw new ZoomError(
            "outcome_unknown",
            "Zoom mutation returned incomplete meeting details; verify remote state before retrying",
          )
        }
      }
      return undefined
    })
    result.applied = outcome.applied
    if (outcome.value) result.meeting = outcome.value
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

const managedMeeting = (meeting: RemoteMeeting): ManagedMeeting => ({
  id: meeting.id,
  title: meeting.title,
  kind: meeting.type === 1 ? "instant" : meeting.type === 2 ? "scheduled" : null,
  startTime: meeting.startedAt,
  durationMinutes: meeting.durationMinutes,
  timezone: meeting.timezone,
  agenda: meeting.agenda,
  joinUrl: meeting.joinUrl,
})

const zoomChange = (change: Readonly<ManagedMeetingChange>): MeetingChange => ({
  ...(change.title !== undefined ? { topic: change.title } : {}),
  ...(change.kind !== undefined ? { type: change.kind === "instant" ? 1 : 2 } : {}),
  ...(change.startTime !== undefined ? { startTime: change.startTime } : {}),
  ...(change.durationMinutes !== undefined ? { durationMinutes: change.durationMinutes } : {}),
  ...(change.timezone !== undefined ? { timezone: change.timezone } : {}),
  ...(change.agenda !== undefined ? { agenda: change.agenda } : {}),
})

/** The remote client must already be bound to the selected account's token manager. */
export const createZoomMeetingManagement = (remote: ZoomRemoteMeetings, account: string) =>
  createMeetingManagement(
    { provider: "zoom", account },
    {
      list: async ({ signal }) => (await remote.list({ signal })).map(managedMeeting),
      get: async (id, { signal }) => managedMeeting(await remote.show(id, { signal })),
      invitation: (id, { signal }) => remote.invitation(id, { signal }),
      create: async (change, { signal }) => {
        const receipt = await remote.create(zoomChange(change), { apply: true, signal })
        if (!receipt.meeting) throw new ZoomError("outcome_unknown", "Zoom did not acknowledge the created meeting")
        return managedMeeting(receipt.meeting)
      },
      update: async (id, change, { signal }) => {
        await remote.update(id, zoomChange(change), { apply: true, signal })
      },
      cancel: async (id, { signal, occurrenceId }) => {
        await remote.cancel(id, { apply: true, signal, occurrenceId })
      },
    },
  )
