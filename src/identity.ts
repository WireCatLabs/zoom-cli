import type { ErrorReason } from "@wirecat/cli-base/standards"
import type { ManifestIdentity } from "@wirecat/cli-base/wcat/manifest"
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

/** Zoom's sign-in, API and MCP hosts, and the hosts its recording and transcript downloads redirect to. */
export const ZOOM_HOSTS: readonly string[] = ["zoom.us", "*.zoom.us", "zoom.com", "*.zoom.com"]

/** What `contracts/wirecat.json` tells WireCat Desktop; src/wcat.ts adds the permission keys. */
export const DESKTOP: ManifestIdentity = {
  ...ZM,
  docs: "https://wirecat.dev/en/docs/zm",
  hosts: ZOOM_HOSTS,
  tagline: "Zoom transcripts and recordings, searchable",
  syncs: "meetings and transcripts",
  signIn: {
    gives: "Lets your agent find your Zoom meetings and read their transcripts and summaries.",
    asks: "Your browser opens Zoom to approve access. Zoom first needs an app of your own, made once in the Zoom App Marketplace.",
  },
}
