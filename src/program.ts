import {
  CliError,
  createDeadline,
  createRenderer,
  exitCodeFor,
  fieldsOf,
  GENERIC_FAILURE,
  projectFields,
  realSleep,
  type SleepLike,
} from "@wirecat/cli-core"
import {
  importFiles,
  listed,
  MeetingError,
  type MeetingSource,
  type MeetingStore,
  type MeetingTranscriptStore,
  pull,
} from "@wirecat/cli-meetings"
import { addMeetingCommands } from "@wirecat/cli-meetings/cli"
import { Command, CommanderError } from "commander"
import { addZoomSkillCommands } from "./agent-skill.js"
import { ZoomApiSource } from "./api.js"
import {
  type ArchiveService,
  type ArchiveTranscriptService,
  addArchiveCommands,
  type RecordingsService,
  type RemoteMeetingsService,
} from "./archive-commands.js"
import { applyArchiveImport, preflightArchiveImport } from "./archive-import.js"
import { readArchiveTranscripts, searchArchiveTranscripts } from "./archive-transcripts.js"
import { addStandardCommands, annotateMeetingCommands } from "./commands.js"
import { profileAccountKey, readConfig, setConfig, type ZoomConfig } from "./config.js"
import { checkCancelled, ZoomError } from "./errors.js"
import { bytes, duration, type ExecutionState, resetCliOptions, startExecution } from "./execution.js"
import { FilesSource, importFile, readDownloadedFiles, validateDownloadedFiles } from "./files.js"
import { addIngestionSearchCommands } from "./ingestion-search-commands.js"
import { login } from "./login.js"
import type { MeetingContextCapabilities } from "./meeting-context.js"
import { addMeetingContextCommands } from "./meeting-context-commands.js"
import {
  getZoomProfile,
  inspectArchive,
  inspectArchiveLocks,
  recoverArchiveLocks,
  verifyArchive,
  ZoomRecordings,
} from "./recordings.js"
import type { RemoteOptions } from "./remote-http.js"
import { ZoomRemoteMeetings } from "./remote-meetings.js"
import { emitReceipt } from "./streaming.js"
import type { TokenManager } from "./tokens.js"
import { runUnifiedSearch, type UnifiedSearch } from "./unified-search.js"
import { VERSION } from "./version.js"
import { addWatchCommand } from "./watch-commands.js"

export interface StoreConnection {
  store: MeetingStore
  accountId: number
  close: () => Promise<void>
  appendTranscripts?: MeetingTranscriptStore["appendTranscripts"]
  unifiedSearch?: UnifiedSearch
  meetingContext?: MeetingContextCapabilities
}
export interface StoreConnectRequest {
  profile: string
  externalId: string
  intent: "read" | "ingestion"
  capability?: "transcript-append"
}
export interface ProgramDeps {
  configPath: string
  tokens: TokenManager
  fetch: typeof fetch
  store?: MeetingStore
  accountId?: number
  connectStore?: (request: StoreConnectRequest) => Promise<StoreConnection>
  transcriptStore?: MeetingTranscriptStore
  unifiedSearch?: UnifiedSearch
  meetingContext?: MeetingContextCapabilities
  source?: MeetingSource
  recordings?: RecordingsService
  remoteMeetings?: RemoteMeetingsService
  archive?: ArchiveService
  archiveTranscripts?: ArchiveTranscriptService
  readFiles?: typeof readDownloadedFiles
  writeFile?: (path: string, content: string, options?: { signal?: AbortSignal }) => Promise<void>
  openBrowser: (url: string, browser?: string) => Promise<void>
  readPaste?: (signal: AbortSignal) => Promise<string>
  data: (text: string) => void
  diagnostic: (text: string) => void
  now?: () => number
  interactive?: boolean
  outputIsTTY?: boolean
  env?: NodeJS.ProcessEnv
  checkSession?: (options?: { signal?: AbortSignal }) => Promise<unknown>
  signal?: AbortSignal
  sleep?: SleepLike
  serveMcp?: (options: {
    signal: AbortSignal
    maxResultBytes?: number
    includeUnifiedSearch?: boolean
    includeMeetingContext?: boolean
  }) => Promise<void>
  streamData?: (text: string, signal: AbortSignal) => Promise<void>
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
const render = (
  value: unknown,
  format: "json" | "jsonl" | "text",
  deps: ProgramDeps,
  fields?: readonly string[],
  preserveEnvelope = false,
): string => {
  if (fields) value = projectFields(value, fields)
  const chunks: string[] = []
  const renderer = createRenderer({
    format: format === "text" ? (deps.outputIsTTY ? "pretty" : "json") : format,
    color: false,
    streams: { data: (text) => chunks.push(`${text}\n`), diagnostic: deps.diagnostic },
  })
  if (
    !preserveEnvelope &&
    format === "jsonl" &&
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  )
    renderer.stream(value.items)
  else renderer.result(value)
  return chunks.join("")
}
export const createProgram = (deps: ProgramDeps): Command => {
  let config: ReturnType<typeof readConfig> | undefined
  const getConfig = () => (config ??= readConfig(deps.configPath))
  let connection: StoreConnection | undefined
  let parsing = false
  let execution: ExecutionState | undefined
  let fields: string[] | undefined
  let activeTokens: TokenManager | undefined
  const currentExecution = () => execution
  const signal = () => currentExecution()?.deadline.signal ?? deps.signal
  const fetchWithSignal =
    (fetcher: typeof fetch): typeof fetch =>
    (input, init) => {
      checkCancelled(signal())
      if (program.opts().offline)
        throw new ZoomError("configuration_error", "the command requires network access; remove --offline")
      const operation = signal()
      return fetcher(input, {
        ...init,
        signal: operation && init?.signal ? AbortSignal.any([operation, init.signal]) : (operation ?? init?.signal),
      })
    }
  const tokens = () => (activeTokens ??= deps.tokens.withSignal(signal(), fetchWithSignal(deps.tokens.options.fetch)))
  const buffer = (text: string) => {
    if (!execution) throw new ZoomError("configuration_error", "command execution is not initialized")
    execution.output.data(text)
  }
  const guardedStore = (store: MeetingStore): MeetingStore =>
    new Proxy(store, {
      get(target, key, receiver) {
        const method = Reflect.get(target, key, receiver)
        return typeof method === "function"
          ? async (...args: unknown[]) => {
              checkCancelled(signal())
              const result = await method.apply(target, args)
              checkCancelled(signal())
              return result
            }
          : method
      },
    })
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
    .option("--interactive", "permit browser approval in an interactive terminal")
    .option("--quiet", "suppress non-error diagnostics")
    .option("--fields <paths>", "project result fields, such as id,title")
    .option(
      "--timeout <duration>",
      "command deadline: reads 30s, login 5m, downloads 1h; watch/MCP have no default",
      duration,
    )
    .option("--max-output-bytes <bytes>", "bound rendered result bytes (default 4194304; zero is unlimited)", bytes)
    .option("--offline", "refuse network requests")
    .exitOverride()
    .configureOutput({ writeOut: deps.data, writeErr: deps.diagnostic, outputError: () => {} })
  const api = () => {
    if (program.opts().offline)
      throw new ZoomError("configuration_error", "the command requires network access; remove --offline")
    if (!getConfig().clientId)
      throw new ZoomError("configuration_error", "run zm config set zoom.clientId <Public Client ID> first")
  }
  program.hook("preAction", async (_root, action) => {
    const opts = action.optsWithGlobals()
    if (opts.json && opts.jsonl) throw new ZoomError("validation_error", "choose --json or --jsonl")
    fields = opts.fields === undefined ? undefined : fieldsOf(opts.fields)
    execution = startExecution(action, { signal: deps.signal, sleep: deps.sleep })
    checkCancelled(signal())
    let family = action
    while (family.parent && family.parent !== program) family = family.parent
    if (
      [
        "login",
        "commands",
        "complete",
        "doctor",
        "config",
        "session",
        "recordings",
        "remote-meetings",
        "serve",
        "skill",
        "watch",
        "search",
      ].includes(family.name()) ||
      (family.name() === "meetings" && ["evidence", "context", "task-proposal"].includes(action.name()))
    )
      return
    const config = getConfig()
    if (opts.offline && action.name() === "pull" && config.source === "api" && !deps.source)
      throw new ZoomError("configuration_error", "API pull requires network access; remove --offline")
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
    buffer(render(value, program.opts().json ? "json" : program.opts().jsonl ? "jsonl" : "text", deps, fields))
  const outputItems = async (values: AsyncIterable<unknown>) => {
    const format = program.opts().jsonl ? "jsonl" : program.opts().json || !deps.outputIsTTY ? "json" : "text"
    const metadata: Partial<ReturnType<typeof listed>> = listed([])
    delete metadata.items
    let count = 0
    if (format === "json") buffer('{"items":[')
    for await (const value of values) {
      checkCancelled(signal())
      const projected = fields ? (projectFields(listed([value]), fields) as { items: unknown[] }).items[0] : value
      if (format === "json") {
        if (count) buffer(",")
        buffer(render(projected, "json", deps).trimEnd())
      } else buffer(render(projected, format, deps))
      count++
    }
    metadata.limit = count
    if (format === "json") buffer(`],${JSON.stringify(metadata).slice(1)}\n`)
    else if (format === "text") buffer(render(count ? metadata : listed([]), "text", deps))
  }
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
      const globals = program.opts()
      if (globals.offline) throw new ZoomError("configuration_error", "login requires network access; remove --offline")
      const headless =
        deps.interactive === false ||
        Boolean(deps.env?.CI) ||
        (deps.interactive !== undefined &&
          (globals.json || globals.jsonl || deps.outputIsTTY === false) &&
          !globals.interactive)
      if (globals.input === false || headless)
        throw new ZoomError("configuration_error", "login requires browser approval; remove --no-input")
      output(
        await login({
          tokens: tokens(),
          signal: signal(),
          openBrowser: (url) => deps.openBrowser(url, opts.browser),
          readPaste: deps.readPaste,
          showUrl: (url) => {
            if (!program.opts().quiet) deps.diagnostic(`Open this URL to approve Zoom login:\n${url}\n`)
          },
        }),
      )
    })
  let activeSource: Promise<MeetingSource> | undefined
  const getSource = (): Promise<MeetingSource> => {
    if (deps.source) return Promise.resolve(deps.source)
    activeSource ??= (async () => {
      const config = getConfig()
      if (config.source === "api") return new ZoomApiSource(tokens(), fetchWithSignal(deps.fetch))
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
  const meetingCommands: Parameters<typeof addMeetingCommands>[1] = {
    get store() {
      return guardedStore(selectedStore ?? unavailableStore)
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
      buffer(render(value, format, deps, fields))
    },
    writeFile: deps.writeFile
      ? async (path, content) => {
          checkCancelled(signal())
          await deps.writeFile?.(path, content, { signal: signal() })
          checkCancelled(signal())
        }
      : undefined,
  }
  addMeetingCommands(program, meetingCommands)
  addStandardCommands(program, {
    output,
    discovery: (value) =>
      buffer(render(value, program.opts().json ? "json" : program.opts().jsonl ? "jsonl" : "text", deps)),
    fields: () => fields,
    raw: buffer,
    doctor: () => {
      const config = getConfig()
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
          throw new ZoomError("configuration_error", "session verification requires network access; remove --offline")
        api()
        return {
          configured: true,
          state: "verified",
          dataProfile: config.accountProfile,
          verified: true,
          profile: await (deps.checkSession
            ? deps.checkSession({ signal: signal() })
            : getZoomProfile(tokens(), fetchWithSignal(deps.fetch), { signal: signal() })),
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
  let watchConfig: ZoomConfig | undefined
  let watchSince: string | undefined
  const watchSleep = deps.sleep
  const receipt = async (value: unknown) => {
    const text = render(value, program.opts().jsonl ? "jsonl" : "text", deps, fields)
    const operation = signal() as AbortSignal
    const grace = operation.aborted ? createDeadline({ timeoutMs: 1000 }) : undefined
    try {
      await emitReceipt(text, program.opts().maxOutputBytes, async (serialized) => {
        if (deps.streamData) await deps.streamData(serialized, grace?.signal ?? operation)
        else deps.data(serialized)
      })
    } finally {
      grace?.dispose()
    }
  }
  addWatchCommand(program, {
    signal: () => signal() as AbortSignal,
    receipt,
    outputIsTTY: deps.outputIsTTY,
    sleep: watchSleep ? (ms, abort) => watchSleep(ms, abort, "retry") : undefined,
    prepare: (folder, flags) => {
      const config = { ...getConfig() }
      const source = flags.source ?? (folder !== undefined ? "files" : config.source)
      const plan = {
        source,
        since: flags.since,
        lookbackDays: flags.lookbackDays ?? 0,
        intervalMs: flags.interval,
        folder: folder ?? config.filesFolder ?? undefined,
      }
      if (source === "files") {
        if (flags.since !== undefined || flags.lookbackDays !== undefined)
          throw new ZoomError("validation_error", "since and lookback days apply only to API watching")
        if (!plan.folder?.trim())
          throw new ZoomError("configuration_error", "set files.folder or provide a folder for file watching")
      } else {
        if (folder !== undefined) throw new ZoomError("validation_error", "API watching does not accept a folder")
        if (program.opts().offline)
          throw new ZoomError("configuration_error", "API watching requires network access; remove --offline")
        if (!deps.source) {
          if (!config.clientId)
            throw new ZoomError("configuration_error", "run zm config set zoom.clientId <Public Client ID> first")
          if (tokens().options.clientId !== config.clientId)
            throw new ZoomError(
              "configuration_error",
              "the OAuth client changed before watch started; retry with matching configuration",
            )
        }
      }
      if (!deps.store && !config.accountProfile)
        throw new ZoomError("configuration_error", "select a local profile with zm config set account.profile <label>")
      watchConfig = config
      watchSince = plan.since
      return plan
    },
    ingest: async (plan, operation) => {
      checkCancelled(operation)
      const config = watchConfig
      if (!config) throw new ZoomError("configuration_error", "watch configuration is unavailable")
      let cycle: StoreConnection | undefined
      let failure: unknown
      let result: Awaited<ReturnType<typeof importFiles>> | undefined
      try {
        if (!deps.store) {
          if (!deps.connectStore) return unavailable()
          if (!config.accountProfile)
            throw new ZoomError(
              "configuration_error",
              "select a local profile with zm config set account.profile <label>",
            )
          try {
            cycle = await deps.connectStore({
              profile: config.accountProfile,
              externalId: profileAccountKey(config.accountProfile),
              intent: "ingestion",
            })
          } catch (error) {
            if (error instanceof CliError || error instanceof MeetingError) throw error
            throw new ZoomError("configuration_error", "could not open the shared meeting store")
          }
        }
        checkCancelled(operation)
        const accountId = cycle?.accountId ?? deps.accountId
        if (!Number.isSafeInteger(accountId) || !accountId || accountId < 1)
          throw new ZoomError("configuration_error", "the selected meeting account is unavailable")
        const store = guardedStore(cycle?.store ?? deps.store ?? unavailableStore)
        if (plan.source === "files") {
          const files = validateDownloadedFiles(
            await (deps.readFiles ?? readDownloadedFiles)(plan.folder ?? ""),
            config.filesTimezone,
          )
          checkCancelled(operation)
          result = await importFiles(
            files.map((file) => importFile(file, accountId, config.filesTimezone)),
            store,
            deps.now?.(),
          )
        } else {
          const original =
            deps.source ??
            new ZoomApiSource(tokens(), fetchWithSignal(deps.fetch), {
              now: deps.now,
              sleep: (ms, abort) => (deps.sleep ?? realSleep)(ms, AbortSignal.any([operation, abort]), "retry"),
            })
          let sourceFailure: CliError | undefined
          const source = new Proxy(original, {
            get(target, key, receiver) {
              const method = Reflect.get(target, key, receiver)
              return typeof method === "function"
                ? async (...args: unknown[]) => {
                    if (sourceFailure) throw sourceFailure
                    checkCancelled(operation)
                    try {
                      const value = await method.apply(target, args)
                      checkCancelled(operation)
                      return value
                    } catch (error) {
                      if (error instanceof CliError && error.code === "outcome_unknown") {
                        sourceFailure = error
                        throw error
                      }
                      checkCancelled(operation)
                      throw error
                    }
                  }
                : method
            },
          })
          let cursorAdvanced = false
          const trackingStore = new Proxy(store, {
            get(target, key, receiver) {
              if (key === "setCursor")
                return async (...args: Parameters<MeetingStore["setCursor"]>) => {
                  await target.setCursor(...args)
                  cursorAdvanced = true
                }
              return Reflect.get(target, key, receiver)
            },
          })
          result = await pull(source, trackingStore, {
            accountId,
            since: watchSince,
            lookbackMs: plan.lookbackDays * 86400000,
            now: deps.now?.(),
          })
          if (sourceFailure) throw sourceFailure
          checkCancelled(operation)
          if (cursorAdvanced) watchSince = undefined
        }
      } catch (error) {
        failure = error
      } finally {
        if (cycle) {
          try {
            await cycle.close()
          } catch {
            failure ??= new ZoomError("configuration_error", "could not close the shared meeting store")
          }
        }
      }
      if (failure) throw failure
      if (!result) return unavailable()
      return result
    },
  })
  const retrySleep = deps.sleep
  const remoteOptions: RemoteOptions = {
    now: deps.now,
    sleep: retrySleep ? (ms, abort) => retrySleep(ms, abort, "retry") : undefined,
  }
  addArchiveCommands(program, {
    output,
    outputItems,
    transcripts: deps.archiveTranscripts ?? { read: readArchiveTranscripts, search: searchArchiveTranscripts },
    receipt,
    outputIsTTY: deps.outputIsTTY,
    api,
    signal,
    now: deps.now ?? Date.now,
    recordings: () => deps.recordings ?? new ZoomRecordings(tokens(), fetchWithSignal(deps.fetch), remoteOptions),
    remoteMeetings: () =>
      deps.remoteMeetings ?? new ZoomRemoteMeetings(tokens(), fetchWithSignal(deps.fetch), remoteOptions),
    archive: deps.archive ?? {
      inspect: inspectArchive,
      verify: verifyArchive,
      locks: inspectArchiveLocks,
      recover: recoverArchiveLocks,
    },
  })
  addZoomSkillCommands(program, () => {
    const renderer = createRenderer({
      format: program.opts().json ? "json" : program.opts().jsonl ? "jsonl" : deps.outputIsTTY ? "pretty" : "json",
      color: false,
      quiet: Boolean(program.opts().quiet),
      streams: { data: buffer, diagnostic: deps.diagnostic },
    })
    return {
      renderer: { ...renderer, result: output, stream: (items) => output({ items: [...items] }) },
      streams: { data: (text) => buffer(`${text}\n`), diagnostic: deps.diagnostic },
      env: deps.env,
    }
  })
  program
    .command("serve")
    .description("serve read-only meeting tools over MCP stdio")
    .requiredOption("--mcp", "use the MCP JSON-RPC protocol")
    .option("--unified-search", "include selected-profile meetings-only unified search")
    .option("--meeting-context", "include account-fixed evidence, person context and task proposals")
    .action(async (options: { unifiedSearch?: boolean; meetingContext?: boolean }) => {
      const opts = program.opts()
      if (opts.json || opts.jsonl || opts.fields)
        throw new ZoomError("validation_error", "MCP stdio controls its own output; omit --json, --jsonl and --fields")
      if (!deps.serveMcp) throw new ZoomError("configuration_error", "the MCP server adapter is not available")
      await deps.serveMcp({
        signal: signal() as AbortSignal,
        maxResultBytes: program.opts().maxOutputBytes,
        ...(options.unifiedSearch ? { includeUnifiedSearch: true } : {}),
        ...(options.meetingContext ? { includeMeetingContext: true } : {}),
      })
    })
  addIngestionSearchCommands(program, {
    signal,
    output: (value) =>
      buffer(render(value, program.opts().jsonl ? "jsonl" : program.opts().json ? "json" : "text", deps, fields, true)),
    outputItems,
    receipt,
    preflight: preflightArchiveImport,
    apply: async function* (plan) {
      if (plan.occurrences === 0) return
      let store = deps.transcriptStore
      let accountId = selectedAccountId
      if (!store) {
        const config = getConfig()
        if (!config.accountProfile || !deps.connectStore)
          throw new ZoomError("configuration_error", "select a local profile with an available transcript append store")
        connection = await deps.connectStore({
          profile: config.accountProfile,
          externalId: profileAccountKey(config.accountProfile),
          intent: "ingestion",
          capability: "transcript-append",
        })
        accountId = connection.accountId
        if (!connection.appendTranscripts)
          throw new ZoomError("configuration_error", "the installed meeting store does not support transcript append")
        store = { appendTranscripts: connection.appendTranscripts }
      }
      for await (const item of applyArchiveImport(plan, store, {
        accountId: accountId ?? 0,
        now: deps.now?.(),
        signal: signal(),
      }))
        yield item
    },
    search: async (request) => {
      if (deps.unifiedSearch) return runUnifiedSearch(deps.unifiedSearch, request)
      const config = getConfig()
      if (!config.accountProfile || !deps.connectStore)
        throw new ZoomError("configuration_error", "select a stored local profile for unified search")
      connection = await deps.connectStore({
        profile: config.accountProfile,
        externalId: profileAccountKey(config.accountProfile),
        intent: "read",
      })
      if (!connection.unifiedSearch)
        throw new ZoomError("configuration_error", "unified search is unavailable in this store connector")
      return runUnifiedSearch(connection.unifiedSearch, request)
    },
  })
  addMeetingContextCommands(program, {
    signal,
    output: (value) =>
      buffer(render(value, program.opts().jsonl ? "jsonl" : program.opts().json ? "json" : "text", deps, fields, true)),
    context: async () => {
      if (deps.meetingContext) return deps.meetingContext
      const config = getConfig()
      if (!config.accountProfile || !deps.connectStore)
        throw new ZoomError("configuration_error", "select a stored local profile for meeting context")
      connection = await deps.connectStore({
        profile: config.accountProfile,
        externalId: profileAccountKey(config.accountProfile),
        intent: "read",
      })
      if (!connection.meetingContext)
        throw new ZoomError("configuration_error", "meeting context is unavailable in this store connector")
      return connection.meetingContext
    },
  })
  annotateMeetingCommands(program)
  const parseAsync = program.parseAsync.bind(program)
  program.parseAsync = async (...args) => {
    if (parsing) throw new ZoomError("validation_error", "concurrent command parsing is unavailable")
    resetCliOptions(program)
    parsing = true
    config = undefined
    activeSource = undefined
    execution = undefined
    activeTokens = undefined
    watchConfig = undefined
    watchSince = undefined
    fields = undefined
    let result = program
    let failed = false
    let failure: unknown
    const running = parseAsync(...args)
    void running.catch(() => {})
    try {
      const active = currentExecution()
      result = active ? await active.deadline.race(() => running) : await running
    } catch (error) {
      await running.catch(() => {})
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
    if (!failed) {
      try {
        checkCancelled(signal())
      } catch (error) {
        failed = true
        failure = error
      }
    }
    currentExecution()?.deadline.dispose()
    parsing = false
    if (failed) {
      currentExecution()?.output.discard()
      throw failure
    }
    currentExecution()?.output.flush(deps.data)
    execution = undefined
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
    const typed = error instanceof CliError || error instanceof MeetingError
    const unknownOutcome = error instanceof Error && "code" in error && error.code === "outcome_unknown"
    const code = typed
      ? error.code
      : unknownOutcome
        ? "outcome_unknown"
        : error instanceof CommanderError
          ? "validation_error"
          : "generic_failure"
    const message = typed
      ? error.message
      : unknownOutcome
        ? "operation outcome is unknown; verify stored state before retrying"
        : "command failed; use --help for usage"
    deps.diagnostic(`${JSON.stringify({ error: { code, message } })}\n`)
    return code === "generic_failure" ? GENERIC_FAILURE : exitCodeFor(code)
  }
}
