import { CliError } from "@wirecat/cli-base"
import { createMeetingSeriesInventoryReader, type MeetingSeriesCandidate } from "@wirecat/cli-core/meetings"
import { object } from "./errors.js"
import { zoomScheduledInstant } from "./occurrence-schedule.js"
import { type RemoteOptions, ZoomRemote } from "./remote-http.js"
import { zoomMeetingPath } from "./remote-meeting-id.js"
import type { ZoomUpcomingCredentials } from "./upcoming-meetings.js"

const candidate = (value: unknown): MeetingSeriesCandidate => {
  const row = object(value)
  const meetingId = typeof row.id === "number" && Number.isSafeInteger(row.id) ? String(row.id) : row.id
  if (typeof meetingId !== "string") throw new CliError("invalid_response", "Zoom inventory meeting id is invalid")
  try {
    zoomMeetingPath(meetingId)
  } catch {
    throw new CliError("invalid_response", "Zoom inventory meeting id is invalid")
  }
  if (row.topic !== undefined && row.topic !== null && (typeof row.topic !== "string" || row.topic.length > 8192))
    throw new CliError("invalid_response", "Zoom inventory topic is invalid")
  if (row.type !== undefined && ![1, 2, 3, 8].includes(row.type as number))
    throw new CliError("invalid_response", "Zoom inventory meeting type is invalid")
  return {
    meetingId,
    title: typeof row.topic === "string" ? row.topic : null,
    kind: row.type === 2 ? "single" : row.type === 3 ? "unscheduled" : row.type === 8 ? "recurring" : "unknown",
    scheduledStartAt: zoomScheduledInstant(row.start_time),
  }
}

/** Scheduled inventory retains recurring series whose original start precedes the requested window. */
export const createZoomSeriesInventoryReader = (
  account: string,
  credentials: ZoomUpcomingCredentials,
  fetcher: typeof fetch,
  options: RemoteOptions = {},
) => {
  if (typeof credentials?.withSignal !== "function")
    throw new CliError("configuration_error", "Zoom credential scope is unavailable")
  const scopedCredentials = credentials.withSignal.bind(credentials)
  const remoteOptions = { ...options }
  return createMeetingSeriesInventoryReader(
    { provider: "zoom", account },
    {
      read: async (context) => {
        const auth = scopedCredentials(context.signal)
        const remote = new ZoomRemote({ tokens: auth.tokens.bind(auth) }, fetcher, remoteOptions)
        const query = new URLSearchParams({ type: "scheduled", page_size: String(context.limit) })
        if (context.cursor !== undefined) query.set("next_page_token", context.cursor)
        const raw = await remote.request(`/users/me/meetings?${query}`, "meeting:read:list_meetings", {
          signal: context.signal,
          maxResponseBytes: context.maxReadBytes,
        })
        if (!Array.isArray(raw.meetings) || raw.meetings.length > context.limit)
          throw new CliError("invalid_response", "Zoom inventory meetings exceed the page limit")
        if (raw.next_page_token !== undefined && typeof raw.next_page_token !== "string")
          throw new CliError("invalid_response", "Zoom inventory continuation is invalid")
        return {
          scope: context.scope,
          after: context.after,
          until: context.until,
          items: raw.meetings.map(candidate),
          nextCursor: raw.next_page_token ? String(raw.next_page_token) : null,
          coverage: { selection: "provider-inventory", partial: false },
        }
      },
    },
  )
}
