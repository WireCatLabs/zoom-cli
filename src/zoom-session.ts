import { CliError, isCliError } from "@wirecat/cli-base"
import { type Configuration, environmentOf, oauthSessionCommand } from "@wirecat/cli-core/cli"
import { type Command, Option } from "commander"
import { addProfile, readConfig, setConfig } from "./config.js"
import { legacyLoginService } from "./folders.js"
import { CLIENT_ID_MISSING, ZM } from "./identity.js"
import type { ProgramDeps } from "./program.js"
import { getZoomProfile } from "./recordings.js"
import { observedFetch } from "./request-events.js"
import { legacyAccountsOf, ZOOM_CODEC, zoomProvider } from "./tokens.js"
import { CLIENT_ID_NEED, checkedClientId, SET_ZOOM_APP, zoomApp, zoomClientId } from "./zoom-app.js"

const configuredClient = (configPath: string, env: NodeJS.ProcessEnv) => {
  try {
    return zoomClientId(readConfig(configPath), env)
  } catch {
    return undefined
  }
}

/** cli-core's `session start | status | end | list` over the entry zm kept before, with Zoom's own app choice. */
export const zoomSessionCommand = (
  deps: Pick<ProgramDeps, "configPath" | "env" | "fetch">,
  resolveSettings: Configuration["resolveSettings"],
): Command =>
  oauthSessionCommand({
    app: ZM,
    // Every session command but `list` acts for one profile, so none runs for a profile nobody named.
    resolveSettings: (flags, options) =>
      resolveSettings(flags, { ...options, needsProfile: options?.needsProfile ?? true }),
    providerId: "zoom",
    service: "Zoom",
    codec: ZOOM_CODEC,
    legacyAccounts: (env, profile) =>
      legacyAccountsOf(legacyLoginService({ env }), configuredClient(deps.configPath, env), profile),
    startOptions: [
      new Option("--client-id <id>", "the Public Client ID of your Zoom app; saved as zoom.client_id once you sign in"),
    ],
    preset: async (command, steps) => {
      const env = environmentOf(command).env ?? process.env
      const given = command.opts<{ clientId?: string }>().clientId
      if (given !== undefined) checkedClientId(given)
      const configClientId = readConfig(deps.configPath).clientId
      let client = zoomApp({ env, configClientId, clientId: given })?.client
      // `session end` forgets the sign-in whichever app made it.
      if (!client && command.name() !== "end") {
        if (command.name() !== "start" || !steps?.answers)
          throw new CliError("configuration_error", SET_ZOOM_APP, { reason: CLIENT_ID_MISSING })
        const answered = checkedClientId(await steps.ask(CLIENT_ID_NEED))
        client = zoomApp({ env, configClientId, clientId: answered })?.client
      }
      const provider = zoomProvider(client?.clientId ?? "")
      return { provider: client ? { ...provider, client } : provider, scopes: [], rotating: true }
    },
    verify: async (command, accessToken, events) => {
      const token = { accessToken, refreshToken: "", expiresAt: 0, scopes: ["user:read:user"] }
      try {
        const signal = environmentOf(command).signal
        const user = await getZoomProfile(
          { tokens: async () => token },
          observedFetch(deps.fetch, events),
          signal ? { signal } : {},
        )
        return { id: user.id, account: { user_id: user.id, email: user.email, display_name: user.displayName } }
      } catch (error) {
        // user:read:user is optional for the app: a sign-in without it still works for meetings.
        const scopeless = isCliError(error) && ["authentication_error", "permission_error"].includes(error.code)
        if (command.name() === "start" && scopeless) return { id: "", account: {} }
        throw error
      }
    },
    claim: () => {},
    afterSignIn: (_command, { client, profile }) => {
      // A refresh uses the configured app, so an app named only for this sign-in is kept with it (WC-SECR-25).
      if (client.source === "flag") setConfig(deps.configPath, "zoom.client_id", client.clientId)
      addProfile(deps.configPath, profile)
    },
    profiles: () => readConfig(deps.configPath).profiles,
  })
