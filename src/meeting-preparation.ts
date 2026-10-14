import { CliError } from "@wirecat/cli-base"
import type { MeetingPreparationReader } from "@wirecat/cli-core/cli"
import type { MeetingProviderScope } from "@wirecat/cli-core/meetings"
import { validateMeetingPreparationRequest } from "@wirecat/cli-core/services"
import { checkCancelled } from "./errors.js"
import type { RemoteOptions } from "./remote-http.js"
import { zoomMeetingPath } from "./remote-meeting-id.js"
import { createZoomUpcomingMeetingReader, type ZoomUpcomingCredentials } from "./upcoming-meetings.js"

export interface MeetingPreparationBinding {
  scope: MeetingProviderScope
  create(upcoming: ReturnType<typeof createZoomUpcomingMeetingReader>): Promise<MeetingPreparationReader>
}
export interface PreparationConnection {
  meetingPreparation?: MeetingPreparationBinding
  close(): Promise<void>
}
export interface ZoomPreparationOptions {
  credentials: () => ZoomUpcomingCredentials
  fetch: typeof fetch
  remoteOptions?: RemoteOptions
}

/** Own one account connection until all provider/store work and close settle. */
export const createZoomPreparationReader =
  (
    deps: ZoomPreparationOptions & {
      connect: () => Promise<PreparationConnection>
    },
  ): MeetingPreparationReader =>
  async (seriesId, request) => {
    zoomMeetingPath(seriesId)
    request = validateMeetingPreparationRequest(seriesId, request)
    checkCancelled(request.signal)
    const credentials = deps.credentials()
    const connection = await deps.connect()
    try {
      checkCancelled(request.signal)
      const binding = connection.meetingPreparation
      if (binding?.scope.provider !== "zoom")
        throw new CliError("configuration_error", "meeting preparation is unavailable for this account")
      const upcoming = createZoomUpcomingMeetingReader(
        binding.scope.account,
        credentials,
        deps.fetch,
        deps.remoteOptions,
      )
      const read = await binding.create(upcoming)
      checkCancelled(request.signal)
      const result = await read(seriesId, request)
      checkCancelled(request.signal)
      return result
    } finally {
      await connection.close()
    }
  }
