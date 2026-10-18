import { CliError, createRenderer, isCliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, itemOf, LOCAL_READ, LOCAL_WRITE, NO_EFFECTS, REMOTE_WRITE } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import type { AnswerFormat } from "./answer-output.js"
import { addStandardCommands } from "./commands.js"
import { setConfig, type ZoomConfig } from "./config.js"
import { login } from "./login.js"
import type { ProgramDeps } from "./program.js"
import { getZoomProfile } from "./recordings.js"
import type { TokenManager } from "./tokens.js"
import { VERSION } from "./version.js"

export const addConfigCommands = (
  program: Command,
  { configPath, getConfig, output }: { configPath: string; getConfig: () => ZoomConfig; output: (body: Body) => void },
): void => {
  const cfg = annotate(program.command("config"), { effects: NO_EFFECTS }).description("local Zoom configuration")
  annotate(cfg.command("show"), { effects: LOCAL_READ })
    .description("show local configuration")
    .action(() => {
      output(itemOf(getConfig()))
    })
  annotate(cfg.command("set"), { effects: LOCAL_WRITE })
    .description("set a configuration value")
    .argument("<key>", "setting name, such as account.profile")
    .argument("<value>", "new value")
    .action((key: string, value: string) => {
      output(itemOf(setConfig(configPath, key, value)))
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
    | "interactive"
    | "env"
    | "outputIsTTY"
    | "openBrowser"
    | "readPaste"
  >
  getConfig: () => ZoomConfig
  output: (body: Body) => void
  buffer: (text: string) => void
  formatOf: () => AnswerFormat
  fields: () => string[] | undefined
  api: () => void
  tokens: () => TokenManager
  fetch: () => typeof fetch
  signal: () => AbortSignal | undefined
}

/** The shared discovery, doctor and session status commands, plus Zoom's browser login. */
export const addSessionCommands = (program: Command, context: SessionCommandDeps): void => {
  const { deps, getConfig, output, buffer, formatOf, fields, api, tokens, fetch, signal } = context
  addStandardCommands(program, {
    output,
    discovery: (value) =>
      createRenderer({
        format: formatOf(),
        color: false,
        streams: { data: (text) => buffer(`${text}\n`), diagnostic: deps.diagnostic },
      }).result(value),
    fields,
    raw: buffer,
    doctor: () => {
      let config: ZoomConfig
      try {
        config = getConfig()
      } catch (error) {
        if (!isCliError(error)) throw error
        return {
          version: VERSION,
          runtime: { node: process.versions.node },
          config: { readable: false, path: deps.configPath, error: error.message },
          dataProfile: null,
          authentication: { configured: null, state: "not_checked" },
          database: "not_checked",
        }
      }
      return {
        version: VERSION,
        runtime: { node: process.versions.node },
        config: { readable: true, path: deps.configPath, source: config.source },
        dataProfile: config.accountProfile,
        authentication: { configured: config.clientId !== null, state: "not_checked" },
        database: "not_checked",
      }
    },
    sessionStatus: async (check) => {
      const config = getConfig()
      if (!config.clientId)
        return { configured: false, state: "not_configured", dataProfile: config.accountProfile, verified: false }
      if (check) {
        if (program.opts().offline)
          throw new CliError("configuration_error", "session verification requires network access; remove --offline")
        api()
        return {
          configured: true,
          state: "verified",
          dataProfile: config.accountProfile,
          verified: true,
          profile: await (deps.checkSession
            ? deps.checkSession({ signal: signal() })
            : getZoomProfile(tokens(), fetch(), { signal: signal() })),
        }
      }
      const saved = deps.tokens.load()
      return {
        configured: true,
        state: saved ? (saved.expiresAt > (deps.now?.() ?? Date.now()) ? "saved" : "expired") : "missing",
        dataProfile: config.accountProfile,
        verified: false,
        ...(saved ? { expiresAt: saved.expiresAt, scopes: saved.scopes } : {}),
      }
    },
  })
  const session = program.commands.find((command) => command.name() === "session")
  if (!session) throw new CliError("configuration_error", "session command group is unavailable")
  const start = session
    .command("start")
    .description("log in to Zoom through your browser")
    .option("--browser <program>", "browser program")
    .action(async (opts: { browser?: string }) => {
      const config = getConfig()
      if (!config.clientId)
        throw new CliError("configuration_error", "run zm config set zoom.client_id <Public Client ID> first")
      const globals = program.opts()
      if (globals.offline) throw new CliError("configuration_error", "login requires network access; remove --offline")
      if (globals.input === false)
        throw new CliError("configuration_error", "login requires browser approval; remove --no-input")
      if (deps.interactive === false || deps.env?.CI)
        throw new CliError(
          "configuration_error",
          "login requires browser approval; run zm session start in an interactive terminal",
        )
      if (
        deps.interactive !== undefined &&
        (globals.json || globals.jsonl || deps.outputIsTTY === false) &&
        !globals.interactive
      )
        throw new CliError(
          "configuration_error",
          "login requires browser approval; add --interactive to log in with piped or JSON output",
        )
      output(
        itemOf(
          await login({
            tokens: tokens(),
            signal: signal(),
            openBrowser: (url) => deps.openBrowser(url, opts.browser),
            readPaste: deps.readPaste,
            showUrl: (url) => {
              if (!program.opts().quiet) deps.diagnostic(`Open this URL to approve Zoom login:\n${url}\n`)
            },
          }),
        ),
      )
    })
  annotate(start, { effects: REMOTE_WRITE, lifetime: "interactive" })
}
