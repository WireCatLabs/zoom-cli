import {
  CliError,
  createDeadline,
  createOutputBuffer,
  createRenderer,
  isCliError,
  projectFields,
  type SleepLike,
} from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import { type Body, checkJson, snakeKeys } from "@wirecat/cli-core/cli"
import type { MeetingSource, MeetingStore } from "@wirecat/cli-core/meetings"
import { Command, CommanderError } from "commander"
import { addZoomSkillCommands } from "./agent-skill.js"
import { type AnswerFormat, bodyOf, renderBody, usageMessage, wholeList } from "./answer-output.js"
import { commandSelection, hostFailureContext, reportFailure } from "./answer-policy.js"
import {
  type ArchiveService,
  type ArchiveTranscriptService,
  addArchiveCommands,
  type RecordingsService,
  type RemoteMeetingsService,
} from "./archive-commands.js"
import { readArchiveTranscripts, searchArchiveTranscripts } from "./archive-transcripts.js"
import { annotateMeetingCommands } from "./commands.js"
import { profileAccountKey, readConfig } from "./config.js"
import { checkCancelled } from "./errors.js"
import { bytes, duration, type ExecutionState, resetCliOptions, startExecution } from "./execution.js"
import { importFile, readDownloadedFiles, validateDownloadedFiles } from "./files.js"
import { installFirstScreen } from "./first-screen.js"
import { liftJsonFields } from "./json-fields.js"
import { addZoomMeetingCommands } from "./meeting-commands.js"
import { type ContextCapture, captureContextSources } from "./meeting-communications-binding.js"
import { addZoomInventoryCommand } from "./meeting-inventory.js"
import { addZoomMcpCommand, type ZoomMcpServeOptions } from "./meeting-mcp-command.js"
import type { ZoomPreparationOptions } from "./meeting-preparation.js"
import { configuredMeetingSource } from "./meeting-source.js"
import { refuseChangeWhenReadOnly } from "./read-only.js"
import type { RecordingScheduleService } from "./recording-schedule.js"
import { addRecordingScheduleCommands } from "./recording-schedule-commands.js"
import { zoomRecordingSchedule } from "./recording-schedule-setup.js"
import {
  inspectArchive,
  inspectArchiveLocks,
  recoverArchiveLocks,
  verifyArchive,
  ZoomRecordings,
} from "./recordings.js"
import type { RemoteOptions } from "./remote-http.js"
import { ZoomRemoteMeetings } from "./remote-meetings.js"
import { addConfigCommands, addSessionCommands } from "./setup-commands.js"
import { addStoreCommands } from "./store-commands.js"
import {
  connectSelectedProfile,
  type StoreConnection,
  type StoreConnectRequest,
  storeUnavailable,
  unavailableStore,
} from "./store-connection.js"
import { emitReceipt } from "./streaming.js"
import type { TokenManager } from "./tokens.js"
import { VERSION } from "./version.js"
import { addWatchCommand } from "./watch-commands.js"
import { createWatchService } from "./watch-service.js"

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
  readBatchInput?: (path: string, signal?: AbortSignal) => Promise<string>
  data: (text: string) => void
  diagnostic: (text: string) => void
  now?: () => number
  outputIsTTY?: boolean
  env?: NodeJS.ProcessEnv
  checkSession?: (options?: { signal?: AbortSignal }) => Promise<unknown>
  signal?: AbortSignal
  sleep?: SleepLike
  serveMcp?: (options: ZoomMcpServeOptions) => Promise<void>
  streamData?: (text: string, signal: AbortSignal) => Promise<void>
}
const answerExitCodes = new WeakMap<Command, number>()
const HELP_EXITS = new Set(["commander.helpDisplayed", "commander.help", "commander.version"])

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
  const openStore = async (
    intent: StoreConnectRequest["intent"],
    context?: ContextCapture,
  ): Promise<StoreConnection> => {
    if (!deps.connectStore) return storeUnavailable()
    const profile = getConfig().accountProfile
    try {
      return await connectSelectedProfile(deps.connectStore, profile, intent, context)
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
  const rendered = (body: Body, format = formatOf(), selectFields = true) => {
    if (!execution) throw new CliError("configuration_error", "command execution is not initialized")
    const answer = renderBody(execution.action, body, {
      format,
      meta: execution.meta(),
      fields: selectFields ? fields : undefined,
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
    refuseChangeWhenReadOnly(action, deps.env ?? process.env)
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
  addConfigCommands(program, { configPath: deps.configPath, getConfig, output })
  const configured = configuredMeetingSource({
    deps,
    getConfig,
    tokens,
    fetch: () => fetchWithSignal(deps.fetch),
  })
  const source = configured.source
  const meetingCommands: Parameters<typeof addZoomMeetingCommands>[1] = {
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
  addZoomMeetingCommands(program, meetingCommands)
  const leaves = (command: Command): Command[] =>
    command.commands.length ? command.commands.flatMap(leaves) : [command]
  // The meeting reads cli-core mounts read the store opened before their action; zoom's own commands open it lazily.
  const storeCommands = new Set(program.commands.filter((group) => !before.has(group)).flatMap(leaves))
  addSessionCommands(program, {
    deps,
    getConfig,
    output,
    buffer,
    formatOf,
    fields: () => fields,
    api,
    tokens,
    fetch: () => fetchWithSignal(deps.fetch),
    signal,
  })
  const watch = createWatchService({
    deps,
    getConfig,
    tokens,
    fetch: () => fetchWithSignal(deps.fetch),
    offline: () => Boolean(program.opts().offline),
    openStore,
    guardedStore,
  })
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
  const retrySleep = deps.sleep
  const remoteOptions: RemoteOptions = {
    now: deps.now,
    sleep: retrySleep ? (ms, abort) => retrySleep(ms, abort, "retry") : undefined,
  }
  addWatchCommand(program, {
    signal: () => signal() as AbortSignal,
    receipt,
    outputIsTTY: deps.outputIsTTY,
    sleep: remoteOptions.sleep,
    prepare: watch.prepare,
    ingest: watch.ingest,
  })
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
  addRecordingScheduleCommands(program, {
    ...zoomRecordingSchedule({ deps, getConfig, withSignal: fetchWithSignal, signal, remoteOptions }),
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
  let capturedContext: ContextCapture | undefined
  const preparationOptions: ZoomPreparationOptions = {
    context: () => {
      const config = getConfig()
      capturedContext ??= captureContextSources(config.contextSources, config.accountProfile)
      return capturedContext
    },
    credentials: () => {
      api()
      return tokens()
    },
    fetch: fetchWithSignal(deps.fetch),
    remoteOptions,
  }
  const inventory = addZoomInventoryCommand(program, {
    config: getConfig,
    ...preparationOptions,
    signal,
    now: deps.now,
    output: (value) => output(bodyOf(value)),
  })
  addZoomMcpCommand(program, {
    fields: () => fields,
    signal,
    serve: deps.serveMcp,
    preparation: preparationOptions,
    inventory,
  })
  addStoreCommands(program, {
    deps,
    connected,
    openStore,
    preparation: preparationOptions,
    signal,
    output,
    outputItems,
    receipt,
    buffer,
    rendered,
    fields: () => fields,
    meta: () => {
      if (!execution) throw new CliError("configuration_error", "command execution is not initialized")
      return execution.meta()
    },
  })
  annotateMeetingCommands(program)
  installFirstScreen(program)
  const parseAsync = program.parseAsync.bind(program)
  program.parseAsync = async (...args) => {
    if (parsing) throw new CliError("validation_error", "concurrent command parsing is unavailable")
    resetCliOptions(program)
    parsing = true
    answerExitCodes.set(program, 0)
    config = undefined
    configured.reset()
    execution = undefined
    activeTokens = undefined
    watch.reset()
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
    if (error instanceof CommanderError && HELP_EXITS.has(error.code)) return 0
    const unknownOutcome = error instanceof Error && "code" in error && error.code === "outcome_unknown"
    const failure = isCliError(error)
      ? error
      : unknownOutcome
        ? new CliError("outcome_unknown", "operation outcome is unknown; verify stored state before retrying")
        : error instanceof CommanderError
          ? new CliError("validation_error", usageMessage(error))
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
