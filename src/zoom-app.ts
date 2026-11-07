import { CliError } from "@wirecat/cli-base"
import { constants, constantsSchema, oauthApp, oauthClientReport } from "@wirecat/cli-core/constants"
import * as v from "valibot"
import { REDIRECT } from "./login.js"

const schema = v.object({
  ...constantsSchema.entries,
  zoom: v.object({ app: v.object({ client_id: v.string() }) }),
})

export const ZOOM_CONSTANTS = new URL("../constants.json", import.meta.url)

export const NO_ZOOM_APP =
  "WireCat has no Zoom app yet; make your own (docs/zoom-app.md) and set zoom.client_id or ZM_ZOOM_CLIENT_ID"

export const SET_ZOOM_APP = "run zm config set zoom.client_id <Public Client ID> first, or set ZM_ZOOM_CLIENT_ID"

/** The Zoom app a sign-in uses (WC-SECR-25): `--client-id`, `ZM_ZOOM_CLIENT_ID`, `zoom.client_id`, the constants. */
export const zoomApp = (options: {
  env: NodeJS.ProcessEnv
  configClientId?: string | null | undefined
  clientId?: string | undefined
}) =>
  oauthApp({
    provider: "zoom",
    prefix: "ZM",
    env: options.env,
    clientId: options.clientId,
    configClientId: options.configClientId ?? undefined,
    wirecat: constants(ZOOM_CONSTANTS, schema).zoom.app,
  })

/** The client id every command after sign-in uses; undefined when nothing names an app. */
export const zoomClientId = (config: { clientId: string | null } | undefined, env: NodeJS.ProcessEnv) =>
  zoomApp({ env, configClientId: config?.clientId })?.client.clientId

export const zoomClientReport = (config: { clientId: string | null } | undefined, env: NodeJS.ProcessEnv) =>
  oauthClientReport(zoomApp({ env, configClientId: config?.clientId }), NO_ZOOM_APP)

export const checkedClientId = (value: string) => {
  if (!value.trim() || /\s/.test(value)) throw new CliError("validation_error", "client id must not contain whitespace")
  return value
}

export const ZOOM_APP_BUILD_URL = "https://marketplace.zoom.us/develop/create"
export const ZOOM_APP_GUIDE_URL = "https://github.com/WireCatLabs/zoom-cli/blob/main/docs/zoom-app.md"

/** Every scope a zm request names; zoom-app.test.ts fails when the code asks for one this list lacks. */
export const ZOOM_APP_SCOPES: readonly { scope: string; required: boolean; use: string }[] = [
  { scope: "meeting:read:list_meetings", required: true, use: "find your meetings and scheduled series" },
  { scope: "meeting:read:list_past_instances", required: true, use: "find each meeting that ran" },
  { scope: "cloud_recording:read:meeting_transcript", required: true, use: "read meeting transcripts" },
  { scope: "meeting:read:list_past_participants", required: true, use: "read who joined and when" },
  { scope: "meeting:read:summary", required: true, use: "read Zoom AI summaries" },
  { scope: "cloud_recording:read:list_user_recordings", required: false, use: "find your cloud recordings" },
  { scope: "cloud_recording:read:list_recording_files", required: false, use: "download recordings and meeting chat" },
  { scope: "user:read:user", required: false, use: "session status --check" },
  { scope: "meeting:read:meeting", required: false, use: "show one meeting, prepare a series" },
  { scope: "meeting:read:invitation", required: false, use: "show a meeting's invitation" },
  { scope: "meeting:write:meeting", required: false, use: "create a meeting" },
  { scope: "meeting:update:meeting", required: false, use: "change a meeting" },
  { scope: "meeting:delete:meeting", required: false, use: "cancel a meeting" },
  { scope: "team_chat:read:list_contacts", required: false, use: "contacts list" },
  { scope: "team_chat:read:contact", required: false, use: "contacts show" },
  { scope: "agentic_search:read:search", required: false, use: "zoom search" },
]

/** What the owner enters when making the Zoom app `zm` signs in with: `zm app`, and the hint of the sign-in's question. */
export const zoomAppSetup = () => ({
  marketplace_url: ZOOM_APP_BUILD_URL,
  guide_url: ZOOM_APP_GUIDE_URL,
  app_type: "General app",
  management: "User-managed",
  oauth: "Public Client OAuth",
  redirect_url: REDIRECT,
  allow_list: [REDIRECT],
  scopes: ZOOM_APP_SCOPES,
  config_key: "zoom.client_id",
})

export const zoomAppChecklist = () => {
  const scopes = (required: boolean) =>
    ZOOM_APP_SCOPES.filter((one) => one.required === required)
      .map((one) => one.scope)
      .join(", ")
  return [
    `1. Open ${ZOOM_APP_BUILD_URL} and build a General app.`,
    "2. Choose User-managed. Under App Credentials, turn on Use Public Client OAuth and copy the Public Client ID.",
    `3. OAuth Redirect URL: ${REDIRECT}`,
    `4. OAuth Allow List: ${REDIRECT}`,
    `5. Add the scopes meetings sync needs: ${scopes(true)}`,
    `   Only for the features you use: ${scopes(false)}`,
    "6. Run zm config set zoom.client_id <Public Client ID>, then zm <profile> session start.",
    `The whole guide: ${ZOOM_APP_GUIDE_URL}`,
  ].join("\n")
}

export const CLIENT_ID_NEED = {
  field: "client_id",
  secret: false,
  prompt: "Public Client ID of your Zoom app",
  hint: `Build a General app (User-managed, Public Client OAuth) at ${ZOOM_APP_BUILD_URL}; zm app lists what to enter.`,
}
