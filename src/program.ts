import { MeetingError, type MeetingSource, type MeetingStore } from "@wirecat/cli-meetings"
import { addMeetingCommands } from "@wirecat/cli-meetings/cli"
import { Command, CommanderError } from "commander"
import { ZoomApiSource } from "./api.js"
import { readConfig, setConfig } from "./config.js"
import { ZoomError } from "./errors.js"
import { FilesSource, importFile, readDownloadedFiles } from "./files.js"
import { login } from "./login.js"
import type { TokenManager } from "./tokens.js"

export interface ProgramDeps {
  configPath: string
  tokens: TokenManager
  fetch: typeof fetch
  store?: MeetingStore
  accountId?: number
  source?: MeetingSource
  readFiles?: typeof readDownloadedFiles
  openBrowser: (url: string, browser?: string) => Promise<void>
  readPaste?: (signal: AbortSignal) => Promise<string>
  data: (text: string) => void
  diagnostic: (text: string) => void
  now?: () => number
}
const unavailable = async (): Promise<never> => {
  throw new ZoomError("configuration_error", "the shared SQLite meeting store is not available yet")
}
const unavailableStore: MeetingStore = {
  saveMeeting: unavailable,
  meetings: unavailable,
  meeting: unavailable,
  participants: unavailable,
  search: unavailable,
  events: unavailable,
  eventCandidates: unavailable,
  createEvent: unavailable,
  createEventSeries: unavailable,
  setEventSeries: unavailable,
  linkMeeting: unavailable,
  cursor: unavailable,
  setCursor: unavailable,
}
const render = (data: unknown, format: "json" | "jsonl" | "text"): string => {
  if (format === "jsonl" && typeof data === "object" && data !== null && "items" in data && Array.isArray(data.items))
    return data.items.map((row) => `${JSON.stringify(row)}\n`).join("")
  return `${JSON.stringify(data, null, format === "text" ? 2 : undefined)}\n`
}
export const createProgram = (deps: ProgramDeps): Command => {
  const config = readConfig(deps.configPath)
  const program = new Command()
    .name("zm")
    .version("0.1.0")
    .description("Zoom meeting transcripts and summaries")
    .option("--json", "one JSON value")
    .option("--jsonl", "one JSON object per item")
    .option("--no-input", "disable interactive login")
    .exitOverride()
    .configureOutput({ writeOut: deps.data, writeErr: deps.diagnostic, outputError: () => {} })
  program.hook("preAction", (_root, action) => {
    if (program.opts().json && program.opts().jsonl) throw new ZoomError("validation_error", "choose --json or --jsonl")
    if (!deps.store && !["login", "show", "set"].includes(action.name()))
      throw new ZoomError("configuration_error", "the shared SQLite meeting store is not available yet")
    if (!deps.store && action.parent?.name() === "meetings")
      throw new ZoomError("configuration_error", "the shared SQLite meeting store is not available yet")
  })
  const output = (value: unknown) =>
    deps.data(render(value, program.opts().json ? "json" : program.opts().jsonl ? "jsonl" : "text"))
  const cfg = program.command("config").description("local Zoom configuration")
  cfg
    .command("show")
    .description("show local configuration")
    .action(() => {
      output(config)
    })
  cfg
    .command("set")
    .description("set a configuration value")
    .argument("<key>")
    .argument("<value>")
    .action((key: string, value: string) => {
      output(setConfig(deps.configPath, key, value))
    })
  program
    .command("login")
    .description("log in to Zoom through your browser")
    .option("--browser <program>", "browser program")
    .action(async (opts: { browser?: string }) => {
      if (!config.clientId)
        throw new ZoomError("configuration_error", "run zm config set zoom.clientId <Public Client ID> first")
      if (program.opts().input === false)
        throw new ZoomError("configuration_error", "login requires browser approval; remove --no-input")
      output(
        await login({
          tokens: deps.tokens,
          openBrowser: (url) => deps.openBrowser(url, opts.browser),
          readPaste: deps.readPaste,
          showUrl: (url) => deps.diagnostic(`Open this URL to approve Zoom login:\n${url}\n`),
        }),
      )
    })
  let fileSource: Promise<FilesSource> | undefined
  const source: MeetingSource =
    deps.source ??
    (config.source === "api"
      ? new ZoomApiSource(deps.tokens, deps.fetch)
      : {
          provider: "zoom",
          name: "file",
          async meetings(since) {
            if (!config.filesFolder)
              throw new ZoomError("configuration_error", "set files.folder before pulling from files")
            fileSource ??= (deps.readFiles ?? readDownloadedFiles)(config.filesFolder).then(
              (files) => new FilesSource(files, config.filesTimezone),
            )
            return (await fileSource).meetings(since)
          },
          async participants() {
            return null
          },
          async transcript(id) {
            return fileSource ? (await fileSource).transcript(id) : null
          },
          async chat() {
            return null
          },
          async summary() {
            return null
          },
          async files() {
            return null
          },
        })
  addMeetingCommands(program, {
    store: deps.store ?? unavailableStore,
    rootIngestion: true,
    accountId: deps.accountId ?? 0,
    source,
    readFiles: async (folder) =>
      (await (deps.readFiles ?? readDownloadedFiles)(folder)).map((file) =>
        importFile(file, deps.accountId ?? 0, config.filesTimezone),
      ),
    now: deps.now,
    write: (value, format) => deps.data(render(value, format)),
  })
  return program
}
export const run = async (args: string[], deps: ProgramDeps): Promise<number> => {
  try {
    await createProgram(deps).parseAsync(args, { from: "user" })
    return 0
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ["commander.helpDisplayed", "commander.help", "commander.version"].includes(String(error.code))
    )
      return 0
    const code =
      error instanceof ZoomError || error instanceof MeetingError
        ? error.code
        : error instanceof CommanderError
          ? "validation_error"
          : "generic_failure"
    const message =
      error instanceof ZoomError || error instanceof MeetingError
        ? error.message
        : "command failed; use --help for usage"
    deps.diagnostic(`${JSON.stringify({ error: { code, message } })}\n`)
    return code === "configuration_error"
      ? 3
      : code === "authentication_error"
        ? 4
        : code === "provider_error"
          ? 11
          : code === "invalid_response"
            ? 13
            : code === "not_found"
              ? 6
              : code === "generic_failure"
                ? 1
                : 2
  }
}
