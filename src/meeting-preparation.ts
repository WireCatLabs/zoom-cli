import { CliError } from "@wirecat/cli-base"
import type { MeetingPreparationReader } from "@wirecat/cli-core/cli"
import type { MeetingProviderScope } from "@wirecat/cli-core/meetings"
import { validateMeetingPreparationRequest } from "@wirecat/cli-core/services"
import { checkCancelled } from "./errors.js"
import type { ContextCapture } from "./meeting-communications-binding.js"
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
export interface PreparationStoreRequest {
  context?: ContextCapture
}
export interface ZoomPreparationOptions {
  context?: () => ContextCapture
  credentials: () => ZoomUpcomingCredentials
  fetch: typeof fetch
  remoteOptions?: RemoteOptions
}

/** Own one account connection until all provider/store work and close settle. */
export const createZoomPreparationReader =
  (
    deps: ZoomPreparationOptions & {
      connect: (context?: ContextCapture) => Promise<PreparationConnection>
    },
  ): MeetingPreparationReader =>
  async (seriesId, request) => {
    zoomMeetingPath(seriesId)
    request = validateMeetingPreparationRequest(seriesId, request)
    checkCancelled(request.signal)
    let context = request.communications ? deps.context?.() : undefined
    if (request.communications) {
      if (!context)
        throw new CliError(
          "configuration_error",
          "configure context.sources for this profile before requesting communications",
        )
      context = context.select(request.communications.sources.map((source) => source.id))
    }
    const credentials = deps.credentials()
    const connection = await (context ? deps.connect(context) : deps.connect())
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
