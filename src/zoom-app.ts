import { constants, constantsSchema, oauthApp, oauthClientReport } from "@wirecat/cli-core/constants"
import * as v from "valibot"

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
