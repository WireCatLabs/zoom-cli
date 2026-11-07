import type { ErrorReason } from "@wirecat/cli-base/standards"
import type { AppIdentity } from "@wirecat/cli-core/cli/start"
import { VERSION } from "./version.js"

export const CLIENT_ID_MISSING = "zoom.client-id-missing"

/** WireCat Desktop asks for the Client ID when it reads this reason, so the wording of the message can change. */
const ZOOM_REASONS: readonly ErrorReason[] = [
  {
    reason: CLIENT_ID_MISSING,
    code: "configuration_error",
    message: "no Zoom app is set: zoom.client_id and ZM_ZOOM_CLIENT_ID are empty",
    details: [],
  },
]

/** Apart from the read-only rules, so the bin can start without loading cli-core's command tree. */
export const ZM: AppIdentity = {
  command: "zm",
  appName: "zoom-cli",
  envPrefix: "ZM",
  description: "Zoom meeting transcripts and summaries",
  version: VERSION,
  messenger: false,
  errors: { reasons: ZOOM_REASONS },
}
