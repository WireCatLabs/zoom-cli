import type { AppIdentity } from "@wirecat/cli-core/cli/start"
import { VERSION } from "./version.js"

/** Apart from the read-only rules, so the bin can start without loading cli-core's command tree. */
export const ZM: AppIdentity = {
  command: "zm",
  appName: "zoom-cli",
  envPrefix: "ZM",
  description: "Zoom meeting transcripts and summaries",
  version: VERSION,
  messenger: false,
}
