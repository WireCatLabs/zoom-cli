import { homedir } from "node:os"
import { dirname, join } from "node:path"
import {
  type CliError,
  createDeadline,
  createRenderer,
  errorObjectOf,
  errorRecordOf,
  exitCodeOfError,
  fieldsOf,
  isCliError,
  projectFields,
  realSleep,
  renderError,
  type SleepLike,
} from "@wirecat/cli-base"
import {
  importFiles,
  listed,
  MeetingError,
  type MeetingSource,
  type MeetingStore,
  type MeetingTranscriptReceiptStore,
  type MeetingTranscriptStore,
  pull,
} from "@wirecat/cli-core/meetings"
import { addMeetingCommands, addMeetingPassageCommand } from "@wirecat/cli-core/meetings/cli"
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
import { snakeKeys } from "./keys.js"
import type { LocalTranscriptionCapabilities } from "./local-transcription.js"
import { addLocalTranscriptionCommands } from "./local-transcription-commands.js"
import { login } from "./login.js"
import type { MeetingContextCapabilities } from "./meeting-context.js"
import { addMeetingContextCommands } from "./meeting-context-commands.js"
import type { MeetingIntegrationCapabilities } from "./meeting-integration.js"
import { addMeetingIntegrationCommands } from "./meeting-integration-commands.js"
import { addMeetingSearchCommands, type MeetingHitSearch } from "./meeting-search-commands.js"
import {
  addMeetingEmbeddingCommand,
  type MeetingModelOptions,
  type MeetingSemanticCapabilities,
  validateMeetingModel,
} from "./meeting-semantic-commands.js"
import { createRecordingScheduleService, type RecordingScheduleService } from "./recording-schedule.js"
import { addRecordingScheduleCommands } from "./recording-schedule-commands.js"
import { fileRecordingScheduleStore } from "./recording-schedule-store.js"
import { createSystemdRecordingArchiveScheduler } from "./recording-schedule-systemd.js"
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
import { TokenManager } from "./tokens.js"
import { runUnifiedSearch, type UnifiedSearch } from "./unified-search.js"
import { VERSION } from "./version.js"
import { addWatchCommand } from "./watch-commands.js"

export interface StoreConnection {
  store: MeetingStore
  accountId: number
  close: () => Promise<void>
  appendTranscripts?: MeetingTranscriptStore["appendTranscripts"]
  appendTranscriptsWithReceipt?: MeetingTranscriptReceiptStore["appendTranscriptsWithReceipt"]
  meetingIntegration?: MeetingIntegrationCapabilities
  meetingSearch?: MeetingHitSearch
  meetingTranscription?: LocalTranscriptionCapabilities
  unifiedSearch?: UnifiedSearch
  meetingContext?: MeetingContextCapabilities
  meetingSemantic?: MeetingSemanticCapabilities
}
export interface StoreConnectRequest {
  profile: string
  externalId: string
  intent: "read" | "ingestion"
  capability?: "transcript-append" | "meeting-integration" | "meeting-search"
}
export interface ProgramDeps {
  configPath: string
  tokens: TokenManager
  fetch: typeof fetch
  store?: MeetingStore
  accountId?: number
  connectStore?: (request: StoreConnectRequest) => Promise<StoreConnection>
  transcriptStore?: Partial<MeetingTranscriptStore & MeetingTranscriptReceiptStore>
  unifiedSearch?: UnifiedSearch
  meetingContext?: MeetingContextCapabilities
  meetingSemantic?: MeetingSemanticCapabilities
  meetingIntegration?: MeetingIntegrationCapabilities
  meetingSearch?: MeetingHitSearch
  meetingTranscription?: LocalTranscriptionCapabilities
  source?: MeetingSource
  recordings?: RecordingsService
  recordingSchedule?: RecordingScheduleService
  recordingScheduleTarget?: { runtime: string; cliPath: string }
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
    semanticModel?: MeetingModelOptions
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
  providerKeys = false,
): string => {
  if (!providerKeys) value = snakeKeys(value)
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
      "command deadline: reads 30s, login 5m, downloads/transcription 1h; watch/MCP have no default",
      duration,
    )
    .option("--max-output-bytes <bytes>", "bound rendered result bytes (default 4194304; zero is unlimited)", bytes)
    .option("--offline", "refuse network requests")
    .option("--debug", "on a failure, its whole record — cause and stack — in place of the short line")
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
      (family.name() === "meetings" &&
        ["evidence", "context", "task-proposal", "embeddings", "update", "link", "transcribe"].includes(action.name()))
    )
      return
    const config = getConfig()
    const ingestion = family.name() === "meetings" && ["sync", "import"].includes(action.name())
    if (opts.offline && ingestion && action.name() !== "import" && config.source === "api" && !deps.source)
      throw new ZoomError("configuration_error", "API sync requires network access; remove --offline")
    if (!selectedStore) {
      if (!deps.connectStore) return unavailable()
      if (!config.accountProfile)
        throw new ZoomError("configuration_error", "select a local profile with zm config set account.profile <label>")
      try {
        connection = await deps.connectStore({
          profile: config.accountProfile,
          externalId: profileAccountKey(config.accountProfile),
          intent: ingestion ? "ingestion" : "read",
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
      const item = snakeKeys(value)
      const projected = fields ? (projectFields(listed([item]), fields) as { items: unknown[] }).items[0] : item
      if (format === "json") {
        if (count) buffer(",")
        buffer(render(projected, "json", deps).trimEnd())
      } else buffer(render(projected, format, deps))
      count++
    }
    metadata.limit = count
    if (format === "json") buffer(`],${JSON.stringify(snakeKeys(metadata)).slice(1)}\n`)
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
    .argument("<key>", "setting name, such as account.profile")
    .argument("<value>", "new value")
    .action((key: string, value: string) => {
      output(setConfig(deps.configPath, key, value))
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
      buffer(render(value, format, deps, fields, false, true))
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
      buffer(
        render(
          value,
          program.opts().json ? "json" : program.opts().jsonl ? "jsonl" : "text",
          deps,
          undefined,
          false,
          true,
        ),
      ),
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
  const session = program.commands.find((command) => command.name() === "session")
  if (!session) throw new ZoomError("configuration_error", "session command group is unavailable")
  session
    .command("start")
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
  let watchConfig: ZoomConfig | undefined
  let watchSince: string | undefined
  const watchSleep = deps.sleep
  const receipt = async (value: unknown) => {
    const text = render(value, program.opts().jsonl ? "jsonl" : program.opts().json ? "json" : "text", deps, fields)
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
    prepare: (target, folder, flags) => {
      const config = { ...getConfig() }
      const source = target ?? config.source
      const plan = {
        source,
        since: flags.sinceTime,
        lookbackDays: flags.lookbackDays ?? 0,
        intervalMs: flags.interval,
        folder: folder ?? config.filesFolder ?? undefined,
      }
      if (source === "files") {
        if (flags.sinceTime !== undefined || flags.lookbackDays !== undefined)
          throw new ZoomError("validation_error", "--since-time and --lookback-days apply only to API watching")
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
            if (isCliError(error)) throw error
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
                      if (isCliError(error) && error.code === "outcome_unknown") {
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
    account: () => {
      const profile = getConfig().accountProfile
      return profile ? profileAccountKey(profile) : undefined
    },
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
  let recordingSchedule = deps.recordingSchedule
  addRecordingScheduleCommands(program, {
    service: () => {
      if (!recordingSchedule) {
        const env = deps.env ?? process.env
        const configDir = dirname(deps.configPath)
        recordingSchedule = createRecordingScheduleService({
          store: fileRecordingScheduleStore(join(configDir, "recording-schedules")),
          backend: createSystemdRecordingArchiveScheduler({
            unitDirectory: join(env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config"), "systemd", "user"),
          }),
          recordings: (job) => {
            const selected = readConfig(deps.configPath)
            if (
              dirname(deps.configPath) !== job.capture.configDir ||
              selected.accountProfile !== job.capture.profile ||
              selected.clientId !== job.capture.clientId
            )
              throw new ZoomError(
                "configuration_error",
                "archive schedule requires its saved profile and Zoom client id; select those settings before running",
              )
            return new ZoomRecordings(
              new TokenManager({
                clientId: job.capture.clientId,
                keyring: deps.tokens.options.keyring,
                service: `zoom-cli:${job.capture.configDir}`,
                fetch: fetchWithSignal(deps.tokens.options.fetch),
                now: deps.now,
                signal: signal(),
              }),
              fetchWithSignal(deps.fetch),
              remoteOptions,
            )
          },
          now: deps.now,
        })
      }
      return recordingSchedule
    },
    capture: () => {
      const selected = getConfig()
      if (!selected.accountProfile || !selected.clientId)
        throw new ZoomError(
          "configuration_error",
          "archive schedules require a configured local profile and Zoom client id",
        )
      if (!deps.recordingScheduleTarget)
        throw new ZoomError("configuration_error", "archive scheduler requires an explicit runtime and CLI path")
      return {
        profile: selected.accountProfile,
        clientId: selected.clientId,
        configDir: dirname(deps.configPath),
        runtime: deps.recordingScheduleTarget.runtime,
        cliPath: deps.recordingScheduleTarget.cliPath,
      }
    },
    offline: () => Boolean(program.opts().offline),
    signal,
    output,
    receipt,
    outputIsTTY: deps.outputIsTTY,
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
    .option("--semantic", "include read-only meeting vector search with an explicit query model")
    .option("--model <model>", "query embedding model: an installed one, or one served at --base-url")
    .option("--base-url <url>", "explicit remote embedding endpoint for semantic queries")
    .option("--dims <n>", "vector size the remote service returns, in dimensions", bytes)
    .action(
      async (options: {
        unifiedSearch?: boolean
        meetingContext?: boolean
        semantic?: boolean
        model?: string
        baseUrl?: string
        dims?: number
      }) => {
        const opts = program.opts()
        if (opts.json || opts.jsonl || opts.fields)
          throw new ZoomError(
            "validation_error",
            "MCP stdio controls its own output; omit --json, --jsonl and --fields",
          )
        if (!deps.serveMcp) throw new ZoomError("configuration_error", "the MCP server adapter is not available")
        if (options.semantic)
          validateMeetingModel({ model: options.model ?? "", baseUrl: options.baseUrl, dims: options.dims })
        else if (options.model !== undefined || options.baseUrl !== undefined || options.dims !== undefined)
          throw new ZoomError("validation_error", "MCP model options require --semantic")
        if (options.semantic && options.baseUrl !== undefined && opts.offline)
          throw new ZoomError("configuration_error", "remote embeddings require network access; remove --offline")
        await deps.serveMcp({
          signal: signal() as AbortSignal,
          maxResultBytes: program.opts().maxOutputBytes,
          ...(options.unifiedSearch ? { includeUnifiedSearch: true } : {}),
          ...(options.meetingContext ? { includeMeetingContext: true } : {}),
          ...(options.semantic
            ? { semanticModel: { model: options.model ?? "", baseUrl: options.baseUrl, dims: options.dims } }
            : {}),
        })
      },
    )
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
        if (!connection.appendTranscripts && !connection.appendTranscriptsWithReceipt)
          throw new ZoomError("configuration_error", "the installed meeting store does not support transcript append")
        store = {
          appendTranscripts: connection.appendTranscripts,
          appendTranscriptsWithReceipt: connection.appendTranscriptsWithReceipt,
        }
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
  const integrationConnection = async (capability: "meeting-integration" | "meeting-search") => {
    const config = getConfig()
    if (!config.accountProfile || !deps.connectStore)
      throw new ZoomError("configuration_error", "select a stored local profile for meeting integration")
    connection = await deps.connectStore({
      profile: config.accountProfile,
      externalId: profileAccountKey(config.accountProfile),
      intent: "read",
      capability,
    })
    return connection
  }
  const integrationOutput = (value: unknown) =>
    buffer(render(value, program.opts().jsonl ? "jsonl" : program.opts().json ? "json" : "text", deps, fields, true))
  addMeetingIntegrationCommands(program, {
    signal,
    output: integrationOutput,
    receipt,
    integration: async () => {
      if (deps.meetingIntegration) return deps.meetingIntegration
      const connected = await integrationConnection("meeting-integration")
      if (!connected.meetingIntegration)
        throw new ZoomError("configuration_error", "meeting integration is unavailable in this store connector")
      return connected.meetingIntegration
    },
  })
  addLocalTranscriptionCommands(program, {
    signal,
    output: integrationOutput,
    receipt,
    capabilities: async () => {
      if (deps.meetingTranscription) return deps.meetingTranscription
      const config = getConfig()
      if (!config.accountProfile || !deps.connectStore)
        throw new ZoomError("configuration_error", "select a stored local profile for transcription")
      connection = await deps.connectStore({
        profile: config.accountProfile,
        externalId: profileAccountKey(config.accountProfile),
        intent: "read",
        capability: "transcript-append",
      })
      if (!connection.meetingTranscription)
        throw new ZoomError("configuration_error", "local transcription is unavailable in this store connector")
      return connection.meetingTranscription
    },
  })
  const meetingContext = async () => {
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
  }
  addMeetingContextCommands(program, {
    signal,
    output: (value) =>
      buffer(render(value, program.opts().jsonl ? "jsonl" : program.opts().json ? "json" : "text", deps, fields, true)),
    context: meetingContext,
  })
  addMeetingPassageCommand(program, {
    signal,
    read: async (reference, options) => {
      if (fields && options.format !== "json")
        throw new ZoomError("validation_error", "passage field selection requires --json or --format json")
      const context = await meetingContext()
      if (!context.passage)
        throw new ZoomError("configuration_error", "meeting passage is unavailable in this store connector")
      return context.passage(reference, options)
    },
    output: (result, format) => {
      if (format === "json") buffer(render(result.packet, program.opts().jsonl ? "jsonl" : "json", deps, fields, true))
      else buffer(result.content)
    },
  })
  const meetingSemantic = async () => {
    if (deps.meetingSemantic) return deps.meetingSemantic
    const config = getConfig()
    if (!config.accountProfile || !deps.connectStore)
      throw new ZoomError("configuration_error", "select a stored local profile for meeting vectors")
    connection = await deps.connectStore({
      profile: config.accountProfile,
      externalId: profileAccountKey(config.accountProfile),
      intent: "read",
    })
    if (!connection.meetingSemantic)
      throw new ZoomError("configuration_error", "meeting vector capabilities are unavailable in this store connector")
    return connection.meetingSemantic
  }
  addMeetingSearchCommands(program, {
    signal,
    offline: () => Boolean(program.opts().offline),
    output: integrationOutput,
    words: async () => {
      if (deps.meetingSearch) return deps.meetingSearch
      const connected = await integrationConnection("meeting-search")
      if (!connected.meetingSearch)
        throw new ZoomError("configuration_error", "meeting search is unavailable in this store connector")
      return connected.meetingSearch
    },
    meaning: meetingSemantic,
    archive: (deps.archiveTranscripts ?? { search: searchArchiveTranscripts }).search,
  })
  addMeetingEmbeddingCommand(program, {
    signal,
    offline: () => Boolean(program.opts().offline),
    receipt,
    output: integrationOutput,
    capabilities: meetingSemantic,
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
  const program = createProgram(deps)
  try {
    await program.parseAsync(args, { from: "user" })
    return 0
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ["commander.helpDisplayed", "commander.help", "commander.version"].includes(String(error.code))
    )
      return 0
    const unknownOutcome = error instanceof Error && "code" in error && error.code === "outcome_unknown"
    const failure = isCliError(error)
      ? error
      : unknownOutcome
        ? new ZoomError("outcome_unknown", "operation outcome is unknown; verify stored state before retrying")
        : error instanceof CommanderError
          ? new ZoomError("validation_error", "command failed; use --help for usage")
          : error
    return reportFailure(failure, args, deps, commandPath(program, args))
  }
}

export const reportFailure = (
  failure: unknown,
  args: readonly string[],
  deps: Pick<ProgramDeps, "diagnostic" | "outputIsTTY">,
  command = "zm",
): number => {
  const end = args.indexOf("--")
  const flags = args.slice(0, end < 0 ? undefined : end)
  const machine = flags.some((word) => word === "--json" || word === "--jsonl")
  const object = errorObjectOf(failure)
  const record = flags.includes("--debug")
    ? errorRecordOf(failure, object, { command, service: "zm", version: VERSION })
    : undefined
  const interactive = deps.outputIsTTY === true && !machine
  deps.diagnostic(`${renderError(object, { cli: "zm", interactive, ...(record ? { record } : {}) })}\n`)
  return exitCodeOfError(object)
}

const commandPath = (program: Command, args: readonly string[]): string => {
  const words: string[] = []
  let current = program
  for (const word of args) {
    if (word === "--") break
    if (word.startsWith("-")) continue
    const next = current.commands.find((command) => command.name() === word || command.aliases().includes(word))
    if (!next) break
    words.push(word)
    current = next
  }
  return words.length ? words.join(" ") : "zm"
}
