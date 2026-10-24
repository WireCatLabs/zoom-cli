import { randomUUID } from "node:crypto"
import { CliError, isCliError, type KeyringStore } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import {
  type Body,
  commandWords,
  grantsAuthority,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  logsInOrOut,
  NO_EFFECTS,
  REMOTE_WRITE,
  refuseCommandName,
} from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { addStandardCommands } from "./commands.js"
import { addProfile, setConfig, type ZoomConfig } from "./config.js"
import { login } from "./login.js"
import { addModelsCommands } from "./models-commands.js"
import { permissionKeys } from "./permissions.js"
import type { ProgramDeps } from "./program.js"
import { getZoomProfile } from "./recordings.js"
import type { TokenManager } from "./tokens.js"
import { addUpgradeCommand } from "./upgrade.js"
import { VERSION } from "./version.js"

const probeKeyring = (keyring: KeyringStore): "available" | "unavailable" => {
  const service = `zoom-cli-doctor:${randomUUID()}`
  let available = false
  try {
    keyring.set(service, "probe", "doctor-test")
    available = keyring.get(service, "probe") === "doctor-test"
  } catch {
    available = false
  } finally {
    try {
      if (!keyring.delete(service, "probe")) available = false
    } catch {
      available = false
    }
  }
  return available ? "available" : "unavailable"
}

export const addConfigCommands = (
  program: Command,
  {
    configPath,
    getConfig,
    output,
    profile,
  }: { configPath: string; getConfig: () => ZoomConfig; output: (body: Body) => void; profile: () => string },
): void => {
  const cfg = annotate(program.command("config"), { effects: NO_EFFECTS }).description("local Zoom configuration")
  annotate(cfg.command("show"), { effects: LOCAL_READ })
    .description("show local configuration")
    .action(() => {
      output(itemOf(getConfig()))
    })
  grantsAuthority(annotate(cfg.command("set"), { effects: LOCAL_WRITE }))
    .description("set a configuration value")
    .argument("<key>", "setting name, such as zoom.client_id")
    .argument("<value>", "new value")
    .action((key: string, value: string) => {
      output(itemOf(setConfig(configPath, key, value, profile, permissionKeys(program))))
    })
}

export interface SessionCommandDeps {
  deps: Pick<
    ProgramDeps,
    | "configPath"
    | "diagnostic"
    | "checkSession"
    | "tokens"
    | "now"
    | "env"
    | "outputIsTTY"
    | "openBrowser"
    | "readPaste"
  >
  getConfig: () => ZoomConfig
  output: (body: Body) => void
  buffer: (text: string) => void
  api: () => void
  profile: () => string
  tokens: () => TokenManager
  fetch: () => typeof fetch
  signal: () => AbortSignal | undefined
}

/** The shared discovery, doctor and session status commands, plus Zoom's browser login. */
export const addSessionCommands = (program: Command, context: SessionCommandDeps): void => {
  const { deps, getConfig, output, buffer, api, profile, tokens, fetch, signal } = context
  addStandardCommands(program, {
    output,
    raw: buffer,
    doctor: () => {
      const keyring = probeKeyring(deps.tokens.options.keyring)
      let config: ZoomConfig
      try {
        config = getConfig()
      } catch (error) {
        if (!isCliError(error)) throw error
        return {
          version: VERSION,
          runtime: { node: process.versions.node },
          config: { readable: false, path: deps.configPath, error: error.message },
          profiles: null,
          authentication: { configured: null, state: "not_checked", keyring },
          database: "not_checked",
        }
      }
      return {
        version: VERSION,
        runtime: { node: process.versions.node },
        config: { readable: true, path: deps.configPath, source: config.source },
        profiles: config.profiles,
        authentication: { configured: config.clientId !== null, state: "not_checked", keyring },
        database: "not_checked",
      }
    },
    sessionStatus: async (check) => {
      const config = getConfig()
      const selected = profile()
      if (!config.clientId) return { configured: false, state: "not_configured", profile: selected, verified: false }
      if (check) {
        if (program.opts().offline)
          throw new CliError("configuration_error", "session verification requires network access; remove --offline")
        api()
        return {
          configured: true,
          state: "verified",
          profile: selected,
          verified: true,
          zoomUser: await (deps.checkSession
            ? deps.checkSession({ signal: signal() })
            : getZoomProfile(tokens(), fetch(), { signal: signal() })),
        }
      }
      const saved = tokens().load()
      return {
        configured: true,
        state: saved ? (saved.expiresAt > (deps.now?.() ?? Date.now()) ? "saved" : "expired") : "missing",
        profile: selected,
        verified: false,
        ...(saved ? { expiresAt: saved.expiresAt, scopes: saved.scopes } : {}),
      }
    },
  })
  addUpgradeCommand(program, { data: buffer, diagnostic: deps.diagnostic })
  addModelsCommands(program, { env: () => deps.env ?? process.env, output, diagnostic: deps.diagnostic })
  const session = program.commands.find((command) => command.name() === "session")
  if (!session) throw new CliError("configuration_error", "session command group is unavailable")
  const start = session
    .command("start")
    .description("log in to Zoom through your browser")
    .option("--browser <program>", "browser program")
    .action(async (opts: { browser?: string }) => {
      const config = getConfig()
      const selected = profile()
      refuseCommandName(selected, commandWords(program), "zm")
      if (!config.clientId)
        throw new CliError("configuration_error", "run zm config set zoom.client_id <Public Client ID> first")
      const globals = program.opts()
      if (globals.offline) throw new CliError("configuration_error", "login requires network access; remove --offline")
      if (globals.input === false)
        throw new CliError("configuration_error", "login requires browser approval; remove --no-input")
      if (deps.env?.CI)
        throw new CliError(
          "configuration_error",
          `login requires browser approval; run zm ${selected} session start yourself`,
        )
      const done = await login({
        tokens: tokens(),
        signal: signal(),
        openBrowser: (url) => deps.openBrowser(url, opts.browser),
        readPaste: deps.readPaste,
        // Without a terminal this line is all an agent can pass on, so --quiet keeps it.
        showUrl: (url) => deps.diagnostic(`Open this URL to approve Zoom login:\n${url}\n`),
      })
      addProfile(deps.configPath, selected)
      output(itemOf({ ...done, profile: selected }))
    })
  logsInOrOut(annotate(start, { effects: REMOTE_WRITE, lifetime: "interactive" }))
}
