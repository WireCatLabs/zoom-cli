import { MeetingError, type MeetingSource, type MeetingStore } from "@wirecat/cli-meetings"
import { addMeetingCommands } from "@wirecat/cli-meetings/cli"
import { Command, CommanderError } from "commander"
import { ZoomApiSource } from "./api.js"
import { profileAccountKey, readConfig, setConfig } from "./config.js"
import { ZoomError } from "./errors.js"
import { FilesSource, importFile, readDownloadedFiles, validateDownloadedFiles } from "./files.js"
import { login } from "./login.js"
import type { TokenManager } from "./tokens.js"
import { VERSION } from "./version.js"

export interface StoreConnection {
  store: MeetingStore
  accountId: number
  close: () => Promise<void>
}
export interface StoreConnectRequest {
  profile: string
  externalId: string
  intent: "read" | "ingestion"
}
export interface ProgramDeps {
  configPath: string
  tokens: TokenManager
  fetch: typeof fetch
  store?: MeetingStore
  accountId?: number
  connectStore?: (request: StoreConnectRequest) => Promise<StoreConnection>
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
  let config: ReturnType<typeof readConfig> | undefined
  const getConfig = () => (config ??= readConfig(deps.configPath))
  let connection: StoreConnection | undefined
  let parsing = false
  let meetingOutput: string[] = []
  let selectedStore = deps.store
  let selectedAccountId = deps.accountId
  const requireAccount = (): number => {
    if (!Number.isSafeInteger(selectedAccountId) || !selectedAccountId || selectedAccountId < 1)
      throw new ZoomError("configuration_error", "the selected meeting account is unavailable")
    return selectedAccountId
  }
  const program = new Command()
    .name("zm")
    .version(VERSION)
    .description("Zoom meeting transcripts and summaries")
    .option("--json", "one JSON value")
    .option("--jsonl", "one JSON object per item")
    .option("--no-input", "disable interactive login")
    .exitOverride()
    .configureOutput({ writeOut: deps.data, writeErr: deps.diagnostic, outputError: () => {} })
  program.hook("preAction", async (_root, action) => {
    const config = getConfig()
    const opts = action.optsWithGlobals()
    if (opts.json && opts.jsonl) throw new ZoomError("validation_error", "choose --json or --jsonl")
    if (action.name() === "login" || action.parent?.name() === "config") return
    if (!selectedStore) {
      if (!deps.connectStore) return unavailable()
      if (!config.accountProfile)
        throw new ZoomError("configuration_error", "select a local profile with zm config set account.profile <label>")
      try {
        connection = await deps.connectStore({
          profile: config.accountProfile,
          externalId: profileAccountKey(config.accountProfile),
          intent: ["pull", "import"].includes(action.name()) ? "ingestion" : "read",
        })
      } catch (error) {
        if (error instanceof ZoomError || error instanceof MeetingError) throw error
        throw new ZoomError("configuration_error", "could not open the shared meeting store")
      }
      selectedStore = connection.store
      selectedAccountId = connection.accountId
    }
    requireAccount()
  })
  const output = (value: unknown) =>
    deps.data(render(value, program.opts().json ? "json" : program.opts().jsonl ? "jsonl" : "text"))
  const cfg = program.command("config").description("local Zoom configuration")
  cfg
    .command("show")
    .description("show local configuration")
    .action(() => {
      output(getConfig())
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
      const config = getConfig()
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
  let activeSource: Promise<MeetingSource> | undefined
  const getSource = (): Promise<MeetingSource> => {
    if (deps.source) return Promise.resolve(deps.source)
    activeSource ??= (async () => {
      const config = getConfig()
      if (config.source === "api") return new ZoomApiSource(deps.tokens, deps.fetch)
      if (!config.filesFolder) throw new ZoomError("configuration_error", "set files.folder before pulling from files")
      return new FilesSource(await (deps.readFiles ?? readDownloadedFiles)(config.filesFolder), config.filesTimezone)
    })()
    return activeSource
  }
  const source: MeetingSource = {
    get provider() {
      return deps.source?.provider ?? "zoom"
    },
    get name() {
      return deps.source?.name ?? (getConfig().source === "api" ? "api" : "file")
    },
    get transcriptFormat() {
      return deps.source ? deps.source.transcriptFormat : "vtt"
    },
    async meetings(since) {
      return (await getSource()).meetings(since)
    },
    async participants(id) {
      return (await getSource()).participants(id)
    },
    async transcript(id) {
      return (await getSource()).transcript(id)
    },
    async chat(id) {
      return (await getSource()).chat(id)
    },
    async summary(id) {
      return (await getSource()).summary(id)
    },
    async files(id) {
      return (await getSource()).files(id)
    },
  }
  addMeetingCommands(program, {
    get store() {
      return selectedStore ?? unavailableStore
    },
    rootIngestion: true,
    get accountId() {
      return requireAccount()
    },
    source,
    readFiles: async (folder) => {
      const config = getConfig()
      return validateDownloadedFiles(await (deps.readFiles ?? readDownloadedFiles)(folder), config.filesTimezone).map(
        (file) => importFile(file, requireAccount(), config.filesTimezone),
      )
    },
    now: deps.now,
    write: (value, format) => {
      meetingOutput.push(render(value, format))
    },
  })
  const parseAsync = program.parseAsync.bind(program)
  program.parseAsync = async (...args) => {
    if (parsing) throw new ZoomError("validation_error", "concurrent command parsing is unavailable")
    parsing = true
    config = undefined
    activeSource = undefined
    meetingOutput = []
    let result = program
    let failed = false
    let failure: unknown
    try {
      result = await parseAsync(...args)
    } catch (error) {
      failed = true
      failure = error
    } finally {
      if (connection) {
        const closing = connection
        connection = undefined
        selectedStore = deps.store
        selectedAccountId = deps.accountId
        try {
          await closing.close()
        } catch {
          if (!failed) {
            failed = true
            failure = new ZoomError("configuration_error", "could not close the shared meeting store")
          }
        }
      }
    }
    parsing = false
    if (failed) {
      meetingOutput = []
      throw failure
    }
    for (const text of meetingOutput) deps.data(text)
    meetingOutput = []
    return result
  }
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
