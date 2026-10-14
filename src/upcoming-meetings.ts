import { CliError } from "@wirecat/cli-base"
import { createUpcomingMeetingReader } from "@wirecat/cli-core/meetings"
import { zoomOccurrenceSchedule } from "./occurrence-schedule.js"
import { type RemoteOptions, ZoomRemote } from "./remote-http.js"
import { zoomMeetingPath } from "./remote-meeting-id.js"
import type { TokenManager } from "./tokens.js"

export interface ZoomUpcomingCredentials {
  withSignal(signal?: AbortSignal): Pick<TokenManager, "tokens">
}

export const createZoomUpcomingMeetingReader = (
  account: string,
  credentials: ZoomUpcomingCredentials,
  fetcher: typeof fetch,
  options: RemoteOptions = {},
) => {
  if (typeof credentials?.withSignal !== "function")
    throw new CliError("configuration_error", "Zoom credential scope is unavailable")
  const scopedCredentials = credentials.withSignal.bind(credentials)
  const remoteOptions = { ...options }
  return createUpcomingMeetingReader(
    { provider: "zoom", account },
    {
      read: async (id, context) => {
        const path = zoomMeetingPath(id)
        const auth = scopedCredentials(context.signal)
        const remote = new ZoomRemote({ tokens: auth.tokens.bind(auth) }, fetcher, remoteOptions)
        const value = await remote.request(path, "meeting:read:meeting", {
          signal: context.signal,
          maxResponseBytes: context.maxReadBytes,
        })
        return zoomOccurrenceSchedule(value, id, context.limit)
      },
    },
  )
}
