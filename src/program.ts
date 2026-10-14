import { homedir } from "node:os"
import { dirname, join } from "node:path"
import {
  CliError,
  createDeadline,
  createOutputBuffer,
  createRenderer,
  errorObjectOf,
  errorRecordOf,
  exitCodeOfError,
  isCliError,
  projectFields,
  realSleep,
  renderError,
  type SleepLike,
} from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import { type Body, checkJson, itemOf, snakeKeys } from "@wirecat/cli-core/cli"
import {
  importFiles,
  type MeetingProjectDiscoveryReader,
  type MeetingSource,
  type MeetingStore,
  type MeetingTranscriptReceiptStore,
  pull,
} from "@wirecat/cli-core/meetings"
import { addMeetingCommands, addMeetingPassageCommand } from "@wirecat/cli-core/meetings/cli"
import { Command, CommanderError } from "commander"
import { addZoomSkillCommands } from "./agent-skill.js"
import { type AnswerFormat, bodyOf, renderBody, wholeList } from "./answer-output.js"
import { hostFailureContext } from "./answer-policy.js"
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
import { checkCancelled } from "./errors.js"
import { bytes, duration, type ExecutionState, resetCliOptions, startExecution } from "./execution.js"
import { FilesSource, importFile, readDownloadedFiles, validateDownloadedFiles } from "./files.js"
import { addIngestionSearchCommands } from "./ingestion-search-commands.js"
import { liftJsonFields } from "./json-fields.js"
import type { LocalTranscriptionCapabilities } from "./local-transcription.js"
import { addLocalTranscriptionCommands } from "./local-transcription-commands.js"
import { login } from "./login.js"
import type { MeetingContextCapabilities } from "./meeting-context.js"
import { addMeetingContextCommands } from "./meeting-context-commands.js"
import type { MeetingIntegrationCapabilities } from "./meeting-integration.js"
import { addMeetingIntegrationCommands } from "./meeting-integration-commands.js"
import { addZoomMcpCommand, type ZoomMcpServeOptions } from "./meeting-mcp-command.js"
import type { MeetingPreparationBinding, ZoomPreparationOptions } from "./meeting-preparation.js"
import { addMeetingReadBindings } from "./meeting-read-command-bindings.js"
import { addMeetingSearchCommands, type MeetingHitSearch } from "./meeting-search-commands.js"
import { addMeetingEmbeddingCommand, type MeetingSemanticCapabilities } from "./meeting-semantic-commands.js"
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
  appendTranscriptsWithReceipt: MeetingTranscriptReceiptStore["appendTranscriptsWithReceipt"]
  meetingIntegration: MeetingIntegrationCapabilities
  meetingSearch: MeetingHitSearch
  meetingPreparation: MeetingPreparationBinding
  meetingProjectEvidence: MeetingProjectDiscoveryReader
  meetingTranscription: LocalTranscriptionCapabilities
  unifiedSearch: UnifiedSearch
  meetingContext: MeetingContextCapabilities
  meetingSemantic: MeetingSemanticCapabilities
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
  serveMcp?: (options: ZoomMcpServeOptions) => Promise<void>
  streamData?: (text: string, signal: AbortSignal) => Promise<void>
}
const unavailable = async (): Promise<never> => {
  throw new CliError("configuration_error", "the shared SQLite meeting store is not available yet")
}
const unavailableStore: MeetingStore = {
  saveMeeting: unavailable,
  account: unavailable,
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
const answerExitCodes = new WeakMap<Command, number>()

export const createProgram = (deps: ProgramDeps): Command => {
  let config: ReturnType<typeof readConfig> | undefined
  const getConfig = () => (config ??= readConfig(deps.configPath))
  let connecting: Promise<StoreConnection> | undefined
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
        throw new CliError("configuration_error", "the command requires network access; remove --offline")
      const operation = signal()
      return fetcher(input, {
        ...init,
        signal: operation && init?.signal ? AbortSignal.any([operation, init.signal]) : (operation ?? init?.signal),
      })
    }
  const tokens = () => (activeTokens ??= deps.tokens.withSignal(signal(), fetchWithSignal(deps.tokens.options.fetch)))
  const buffer = (text: string) => {
    if (!execution) throw new CliError("configuration_error", "command execution is not initialized")
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
      throw new CliError("configuration_error", "the selected meeting account is unavailable")
    return selectedAccountId
  }
  const openStore = async (intent: StoreConnectRequest["intent"]): Promise<StoreConnection> => {
    if (!deps.connectStore) return unavailable()
    const profile = getConfig().accountProfile
    if (!profile)
      throw new CliError("configuration_error", "select a local profile with zm config set account.profile <label>")
    try {
      return await deps.connectStore({ profile, externalId: profileAccountKey(profile), intent })
    } catch (error) {
      if (isCliError(error)) throw error
      throw new CliError("configuration_error", "could not open the shared meeting store")
    }
  }
  const connected = (intent: StoreConnectRequest["intent"] = "read") => (connecting ??= openStore(intent))
  const program = new Command()
    .name("zm")
    .version(VERSION)
    .description("Zoom meeting transcripts and summaries")
    .option("--json", "one JSON value; --json=id,title keeps only those fields")
    .option("--jsonl", "one JSON object per item")
    .option("--no-input", "disable interactive login")
    .option("--interactive", "permit browser approval in an interactive terminal")
    .option("--quiet", "suppress non-error diagnostics")
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
  const formatOf = (): AnswerFormat =>
    program.opts().jsonl ? "jsonl" : program.opts().json || !deps.outputIsTTY ? "json" : "pretty"
  const rendered = (body: Body, format = formatOf()) => {
    if (!execution) throw new CliError("configuration_error", "command execution is not initialized")
    const answer = renderBody(execution.action, body, {
      format,
      meta: execution.meta(),
      fields,
      quiet: Boolean(program.opts().quiet),
      diagnostic: deps.diagnostic,
    })
    answerExitCodes.set(program, Math.max(answerExitCodes.get(program) ?? 0, answer.exitCode))
    return answer.text
  }
  const api = () => {
    if (program.opts().offline)
      throw new CliError("configuration_error", "the command requires network access; remove --offline")
    if (!getConfig().clientId)
      throw new CliError("configuration_error", "run zm config set zoom.client_id <Public Client ID> first")
  }
  program.hook("preAction", async (_root, action) => {
    const opts = action.optsWithGlobals()
    if (opts.json && opts.jsonl) throw new CliError("validation_error", "choose --json or --jsonl")
    checkJson(action, { json: opts.json === true, ...(fields ? { fields: fields.join(",") } : {}) }, false)
    execution = startExecution(action, { signal: deps.signal, sleep: deps.sleep, now: deps.now })
    checkCancelled(signal())
    if (!storeCommands.has(action)) return
    const config = getConfig()
    const ingestion = action.parent?.name() === "meetings" && ["sync", "import"].includes(action.name())
    if (opts.offline && ingestion && action.name() !== "import" && config.source === "api" && !deps.source)
      throw new CliError("configuration_error", "API sync requires network access; remove --offline")
    if (!selectedStore) {
      const connection = await connected(ingestion ? "ingestion" : "read")
      selectedStore = connection.store
      selectedAccountId = connection.accountId
    }
    requireAccount()
  })
  const output = (body: Body) => buffer(rendered(body))
  const outputItems = async (values: AsyncIterable<unknown>) => {
    const items: unknown[] = []
    // Fails on the row that crosses --max-output-bytes, so a long iterator stops reading there.
    const measured = createOutputBuffer({ maxOutputBytes: program.opts().maxOutputBytes })
    for await (const value of values) {
      checkCancelled(signal())
      const item = snakeKeys(value)
      measured.data(JSON.stringify(fields ? projectFields(item, fields) : item))
      items.push(item)
    }
    output(wholeList("list", items))
  }
  const cfg = program.command("config").description("local Zoom configuration")
  cfg
    .command("show")
    .description("show local configuration")
    .action(() => {
      output(itemOf(getConfig()))
    })
  cfg
    .command("set")
    .description("set a configuration value")
    .argument("<key>", "setting name, such as account.profile")
    .argument("<value>", "new value")
    .action((key: string, value: string) => {
      output(itemOf(setConfig(deps.configPath, key, value)))
    })
  let activeSource: Promise<MeetingSource> | undefined
  const getSource = (): Promise<MeetingSource> => {
    if (deps.source) return Promise.resolve(deps.source)
    activeSource ??= (async () => {
      const config = getConfig()
      if (config.source === "api") return new ZoomApiSource(tokens(), fetchWithSignal(deps.fetch))
      if (!config.filesFolder) throw new CliError("configuration_error", "set files.folder before pulling from files")
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
    write: (value) => output(bodyOf(value)),
    writeFile: deps.writeFile
      ? async (path, content) => {
          checkCancelled(signal())
          await deps.writeFile?.(path, content, { signal: signal() })
          checkCancelled(signal())
        }
      : undefined,
  }
  const before = new Set(program.commands)
  addMeetingCommands(program, meetingCommands)
  const leaves = (command: Command): Command[] =>
    command.commands.length ? command.commands.flatMap(leaves) : [command]
  // The meeting reads cli-core mounts read the store opened before their action; zoom's own commands open it lazily.
  const storeCommands = new Set(program.commands.filter((group) => !before.has(group)).flatMap(leaves))
  addStandardCommands(program, {
    output,
    discovery: (value) =>
      createRenderer({
        format: formatOf(),
        color: false,
        streams: { data: (text) => buffer(`${text}\n`), diagnostic: deps.diagnostic },
      }).result(value),
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
          throw new CliError("configuration_error", "session verification requires network access; remove --offline")
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
  if (!session) throw new CliError("configuration_error", "session command group is unavailable")
  session
    .command("start")
    .description("log in to Zoom through your browser")
    .option("--browser <program>", "browser program")
    .action(async (opts: { browser?: string }) => {
      const config = getConfig()
      if (!config.clientId)
        throw new CliError("configuration_error", "run zm config set zoom.client_id <Public Client ID> first")
      const globals = program.opts()
      if (globals.offline) throw new CliError("configuration_error", "login requires network access; remove --offline")
      const headless =
        deps.interactive === false ||
        Boolean(deps.env?.CI) ||
        (deps.interactive !== undefined &&
          (globals.json || globals.jsonl || deps.outputIsTTY === false) &&
          !globals.interactive)
      if (globals.input === false || headless)
        throw new CliError("configuration_error", "login requires browser approval; remove --no-input")
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
  let watchConfig: ZoomConfig | undefined
  let watchSince: string | undefined
  const watchSleep = deps.sleep
  const receipt = async (body: Body) => {
    const text = rendered(body)
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
          throw new CliError("validation_error", "--since-time and --lookback-days apply only to API watching")
        if (!plan.folder?.trim())
          throw new CliError("configuration_error", "set files.folder or provide a folder for file watching")
      } else {
        if (folder !== undefined) throw new CliError("validation_error", "API watching does not accept a folder")
        if (program.opts().offline)
          throw new CliError("configuration_error", "API watching requires network access; remove --offline")
        if (!deps.source) {
          if (!config.clientId)
            throw new CliError("configuration_error", "run zm config set zoom.client_id <Public Client ID> first")
          if (tokens().options.clientId !== config.clientId)
            throw new CliError(
              "configuration_error",
              "the OAuth client changed before watch started; retry with matching configuration",
            )
        }
      }
      if (!deps.store && !config.accountProfile)
        throw new CliError("configuration_error", "select a local profile with zm config set account.profile <label>")
      watchConfig = config
      watchSince = plan.since
      return plan
    },
    ingest: async (plan, operation) => {
      checkCancelled(operation)
      const config = watchConfig
      if (!config) throw new CliError("configuration_error", "watch configuration is unavailable")
      let cycle: StoreConnection | undefined
      let failure: unknown
      let result: Awaited<ReturnType<typeof importFiles>> | undefined
      try {
        if (!deps.store) cycle = await openStore("ingestion")
        checkCancelled(operation)
        const accountId = cycle?.accountId ?? deps.accountId
        if (!Number.isSafeInteger(accountId) || !accountId || accountId < 1)
          throw new CliError("configuration_error", "the selected meeting account is unavailable")
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
            failure ??= new CliError("configuration_error", "could not close the shared meeting store")
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
              throw new CliError(
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
        throw new CliError(
          "configuration_error",
          "archive schedules require a configured local profile and Zoom client id",
        )
      if (!deps.recordingScheduleTarget)
        throw new CliError("configuration_error", "archive scheduler requires an explicit runtime and CLI path")
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
      format: formatOf(),
      color: false,
      quiet: Boolean(program.opts().quiet),
      streams: { data: buffer, diagnostic: deps.diagnostic },
    })
    return {
      renderer: {
        ...renderer,
        result: (value) => output(bodyOf(value)),
        stream: (items) => output(wholeList("skill", [...items])),
      },
      streams: { data: (text) => buffer(`${text}\n`), diagnostic: deps.diagnostic },
      env: deps.env,
    }
  })
  const preparationOptions: ZoomPreparationOptions = {
    credentials: () => {
      api()
      return tokens()
    },
    fetch: fetchWithSignal(deps.fetch),
    remoteOptions,
  }
  addZoomMcpCommand(program, { fields: () => fields, signal, serve: deps.serveMcp, preparation: preparationOptions })
  addIngestionSearchCommands(program, {
    signal,
    output,
    outputItems,
    receipt,
    preflight: preflightArchiveImport,
    apply: async function* (plan) {
      if (plan.occurrences === 0) return
      const connection = await connected("ingestion")
      for await (const item of applyArchiveImport(plan, connection, {
        accountId: connection.accountId,
        now: deps.now?.(),
        signal: signal(),
      }))
        yield item
    },
    search: async (request) => runUnifiedSearch((await connected()).unifiedSearch, request),
  })
  addMeetingReadBindings(program, {
    project: {
      read: async (project, request) => (await connected()).meetingProjectEvidence(project, request),
      signal,
      now: deps.now,
      output: (value) => output(bodyOf(value)),
    },
    preparation: {
      ...preparationOptions,
      connect: () => openStore("read"),
    },
  })
  addMeetingIntegrationCommands(program, {
    signal,
    output,
    receipt,
    integration: async () => (await connected()).meetingIntegration,
  })
  addLocalTranscriptionCommands(program, {
    signal,
    output,
    receipt,
    capabilities: async () => (await connected()).meetingTranscription,
  })
  const meetingContext = async () => (await connected()).meetingContext
  addMeetingContextCommands(program, {
    signal,
    output,
    context: meetingContext,
  })
  addMeetingPassageCommand(program, {
    signal,
    read: async (reference, options) => {
      if (fields && options.format !== "json")
        throw new CliError("validation_error", "passage field selection requires --json or --format json")
      return (await meetingContext()).passage(reference, options)
    },
    output: (result, format) => {
      if (format === "json") buffer(rendered(bodyOf(result.packet), program.opts().jsonl ? "jsonl" : "json"))
      else buffer(result.content)
    },
  })
  const meetingSemantic = async () => (await connected()).meetingSemantic
  addMeetingSearchCommands(program, {
    signal,
    offline: () => Boolean(program.opts().offline),
    output,
    words: async () => (await connected()).meetingSearch,
    meaning: meetingSemantic,
    archive: (deps.archiveTranscripts ?? { search: searchArchiveTranscripts }).search,
  })
  addMeetingEmbeddingCommand(program, {
    signal,
    offline: () => Boolean(program.opts().offline),
    receipt,
    output,
    capabilities: meetingSemantic,
  })
  annotateMeetingCommands(program)
  const parseAsync = program.parseAsync.bind(program)
  program.parseAsync = async (...args) => {
    if (parsing) throw new CliError("validation_error", "concurrent command parsing is unavailable")
    resetCliOptions(program)
    parsing = true
    answerExitCodes.set(program, 0)
    config = undefined
    activeSource = undefined
    execution = undefined
    activeTokens = undefined
    watchConfig = undefined
    watchSince = undefined
    const lifted = liftJsonFields(program, args)
    fields = lifted.fields
    let result = program
    let failed = false
    let failure: unknown
    const running = parseAsync(...lifted.args)
    void running.catch(() => {})
    try {
      const active = currentExecution()
      result = active ? await active.deadline.race(() => running) : await running
    } catch (error) {
      await running.catch(() => {})
      failed = true
      failure = error
    } finally {
      if (connecting) {
        const closing = connecting
        connecting = undefined
        selectedStore = deps.store
        selectedAccountId = deps.accountId
        try {
          await (await closing.catch(() => undefined))?.close()
        } catch {
          if (!failed) {
            failed = true
            failure = new CliError("configuration_error", "could not close the shared meeting store")
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
    return answerExitCodes.get(program) ?? 0
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
        ? new CliError("outcome_unknown", "operation outcome is unknown; verify stored state before retrying")
        : error instanceof CommanderError
          ? new CliError("validation_error", "command failed; use --help for usage")
          : error
    const selected = commandSelection(program, args)
    return reportFailure(
      failure,
      args,
      deps,
      selected.path,
      hostFailureContext(program, metaOf(selected.action).effects),
    )
  }
}

export const reportFailure = (
  failure: unknown,
  args: readonly string[],
  deps: Pick<ProgramDeps, "diagnostic" | "outputIsTTY">,
  command = "zm",
  context: import("@wirecat/cli-base").FailureContext = hostFailureContext(),
): number => {
  const end = args.indexOf("--")
  const flags = args.slice(0, end < 0 ? undefined : end)
  const machine = flags.some((word) => word === "--json" || word === "--jsonl")
  const object = errorObjectOf(failure, context)
  const record = flags.includes("--debug")
    ? errorRecordOf(failure, object, { command, service: "zm", version: VERSION })
    : undefined
  const interactive = deps.outputIsTTY === true && !machine
  deps.diagnostic(`${renderError(object, { cli: "zm", interactive, ...(record ? { record } : {}) })}\n`)
  return exitCodeOfError(object)
}

const commandSelection = (program: Command, args: readonly string[]) => {
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
  return { path: words.length ? words.join(" ") : "zm", action: current }
}
