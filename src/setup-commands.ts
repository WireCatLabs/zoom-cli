import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import {
  answerStdinOption,
  type Body,
  commandWords,
  environmentOf,
  grantsAuthority,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  logsInOrOut,
  NO_EFFECTS,
  REMOTE_WRITE,
  refuseCommandName,
  signInSteps,
} from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { addStandardCommands } from "./commands.js"
import { addProfile, inspectConfig, setConfig, unsetConfig, type ZoomConfig } from "./config.js"
import { login } from "./login.js"
import { addModelsCommands } from "./models-commands.js"
import { permissionKeys } from "./permissions.js"
import type { ProgramDeps } from "./program.js"
import { getZoomProfile } from "./recordings.js"
import type { TokenManager } from "./tokens.js"
import { addUpgradeCommand } from "./upgrade.js"

const refuseAgentPermissions = (command: Command, key: string) => {
  if (environmentOf(command).agent && (key === "permissions" || key.startsWith("permissions.")))
    throw new CliError("permission_error", "change profile permissions in a terminal")
}

export const addConfigCommands = (
  program: Command,
  {
    configPath,
    output,
    warn,
    named,
  }: {
    configPath: string
    output: (body: Body) => void
    warn: (text: string) => void
    /** The profile named for this command, if any; never asks for one. */
    named: () => string | undefined
  },
): void => {
  const cfg = annotate(program.command("config"), { effects: NO_EFFECTS }).description("local Zoom configuration")
  annotate(cfg.command("show"), { effects: LOCAL_READ })
    .description("show local configuration")
    .action(() => {
      const { config, issues } = inspectConfig(configPath, permissionKeys(program))
      output(itemOf(config))
      for (const issue of issues)
        warn(`${issue.what}, so it is left out${issue.fix ? ` — \`${issue.fix}\` removes it` : ""}`)
    })
  grantsAuthority(annotate(cfg.command("set"), { effects: LOCAL_WRITE }))
    .description("set a configuration value")
    .argument("<key>", "setting name, such as zoom.client_id")
    .argument("<value>", "new value")
    .action(function (this: Command, key: string, value: string) {
      refuseAgentPermissions(this, key)
      output(itemOf(setConfig(configPath, key, value, named, permissionKeys(program))))
    })
  grantsAuthority(annotate(cfg.command("unset"), { effects: LOCAL_WRITE, examples: ["zm config unset files.folder"] }))
    .description("remove a setting, or a part of the file doctor reports a problem in")
    .argument("<key>", "setting name, such as files.folder, or the key a doctor fix names")
    .action(function (this: Command, key: string) {
      refuseAgentPermissions(this, key)
      output(itemOf(unsetConfig(configPath, key, named(), permissionKeys(program))))
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
    | "stdin"
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

const PASTE_PROMPT = "If the browser does not come back by itself, the address it ended on (code=…&state=…)"

/** The shared discovery, doctor and session status commands, plus Zoom's browser login. */
export const addSessionCommands = (program: Command, context: SessionCommandDeps): void => {
  const { deps, getConfig, output, buffer, api, profile, tokens, fetch, signal } = context
  addStandardCommands(program, {
    output,
    raw: buffer,
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
    .addOption(answerStdinOption())
    .action(async (opts: { browser?: string; answerStdin?: boolean }) => {
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
      const steps = signInSteps({
        diagnostic: (line) => deps.diagnostic(`${line}\n`),
        json: globals.json === true || globals.jsonl === true,
        answers: opts.answerStdin === true,
        ...(deps.stdin ? { input: deps.stdin } : {}),
      })
      const done = await login({
        tokens: tokens(),
        signal: signal(),
        openBrowser: (url) => deps.openBrowser(url, opts.browser),
        readPaste: steps.answers
          ? (stop) =>
              steps
                .ask({ field: "redirect", secret: true, prompt: PASTE_PROMPT }, stop)
                // The browser's callback won the race; the question is withdrawn, not failed.
                .catch((error: unknown) => (stop.aborted ? new Promise<string>(() => {}) : Promise.reject(error)))
          : deps.readPaste,
        showUrl: (url) =>
          steps.answers
            ? steps.openUrl(url, "Approve access to Zoom in the browser")
            : // Without a terminal this line is all an agent can pass on, so --quiet keeps it.
              deps.diagnostic(`Open this URL to approve Zoom login:\n${url}\n`),
      })
      addProfile(deps.configPath, selected)
      output(itemOf({ ...done, profile: selected }))
    })
  logsInOrOut(annotate(start, { effects: REMOTE_WRITE, lifetime: "interactive" }))
}
