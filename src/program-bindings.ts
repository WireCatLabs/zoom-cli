import {
  CliError,
  createDeadline,
  createOutputBuffer,
  createRenderer,
  fieldsOf,
  isCliError,
  projectFields,
} from "@wirecat/cli-base"
import { type Body, environmentOf, snakeKeys } from "@wirecat/cli-core/cli"
import type { MeetingStore } from "@wirecat/cli-core/meetings"
import type { Command } from "commander"
import { addZoomSkillCommands } from "./agent-skill.js"
import { declareZoomAnswers } from "./answer-entities.js"
import { type AnswerFormat, bodyOf, renderBody, wholeList } from "./answer-output.js"
import { addArchiveCommands } from "./archive-commands.js"
import { readArchiveTranscripts, searchArchiveTranscripts } from "./archive-transcripts.js"
import { annotateMeetingCommands } from "./commands.js"
import { filesZone, profileAccountKey, readConfig } from "./config.js"
import { cancellableStore, checkCancelled, ZoneAssumptions } from "./errors.js"
import { commandDeadline, duration, type ExecutionState, sharedExecution } from "./execution.js"
import { fileNamesHelp, importFile, readDownloadedFiles, validateDownloadedFiles } from "./files.js"
import { installFirstScreen } from "./first-screen.js"
import { addMcpCommands, runForAgent } from "./mcp-command.js"
import { addZoomMeetingCommands } from "./meeting-commands.js"
import { type ContextCapture, captureContextSources } from "./meeting-communications-binding.js"
import { addZoomInventoryCommand } from "./meeting-inventory.js"
import type { ZoomPreparationOptions } from "./meeting-preparation.js"
import { configuredMeetingSource } from "./meeting-source.js"
import { discoveryLevels, guardCommand } from "./permissions.js"
import { chooseProfile } from "./profile.js"
import { PROFILE_HELP, recordProfile } from "./profile-word.js"
import type { ProgramDeps } from "./program.js"
import { addProgressCommands } from "./progress-commands.js"
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
import type { ZoomLifecycle } from "./run.js"
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
import { meetingProgress } from "./sync-progress.js"
import type { TokenManager } from "./tokens.js"
import { addWatchCommand } from "./watch-commands.js"
import { createWatchService } from "./watch-service.js"

export const bindZoomProgram = (
  program: Command,
  given: ProgramDeps,
  lifecycle: ZoomLifecycle,
  execute: (args: string[], deps: ProgramDeps) => Promise<number>,
): void => {
  const deps: ProgramDeps = {
    ...given,
    data: (text) => environmentOf(program).streams?.data(text.replace(/\n$/, "")),
    diagnostic: (text) => environmentOf(program).streams?.diagnostic(text.replace(/\n$/, "")),
  }
  program.description(`Zoom meeting transcripts and summaries\n\n${PROFILE_HELP}`)

  let settleCommand = () => {}
  const commandSettled = new Promise<void>((resolve) => {
    settleCommand = resolve
  })
  const parse = program.parseAsync.bind(program)
  program.parseAsync = async (...args) => {
    try {
      return await parse(...args)
    } finally {
      settleCommand()
    }
  }
  let config: ReturnType<typeof readConfig> | undefined
  const getConfig = () => (config ??= readConfig(deps.configPath))
  let connecting: Promise<StoreConnection> | undefined
  let execution: ExecutionState | undefined
  let fields: string[] | undefined
  let progress: ReturnType<typeof meetingProgress> | undefined
  let activeTokens: TokenManager | undefined
  const named = () => {
    const env = deps.env ?? process.env
    return program.opts().profile !== undefined || env.ZM_PROFILE?.trim() || env.ZM_PROFILE_LOCK?.trim()
      ? profile()
      : undefined
  }
  let selectedProfile: string | undefined
  const profile = () =>
    (selectedProfile ??= chooseProfile({
      word: program.opts().profile,
      env: deps.env ?? process.env,
      profiles: () => getConfig().profiles,
    }))
  const currentExecution = () => execution
  const signal = () => currentExecution()?.signal ?? environmentOf(program).signal ?? deps.signal
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
  const tokens = () =>
    (activeTokens ??= deps.tokens
      .forProfile(profile(), getConfig().legacyProfile)
      .withSignal(signal(), fetchWithSignal(deps.tokens.options.fetch)))
  const buffer = (text: string) => {
    if (!execution) throw new CliError("configuration_error", "command execution is not initialized")
    execution.output.data(text)
  }
  const guardedStore = (store: MeetingStore): MeetingStore => cancellableStore(store, signal)
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
    const selected = profile()
    if (intent === "ingestion") recordProfile(deps.configPath, selected)
    try {
      const connection = await connectSelectedProfile(deps.connectStore, selected, intent, context)
      if (signal()?.aborted) {
        await connection.close()
        checkCancelled(signal())
      }
      let closing: Promise<void> | undefined
      const close = () => (closing ??= connection.close())
      environmentOf(program).trackCloseable?.({
        close: async () => {
          await commandSettled
          await close()
        },
      })
      return { ...connection, close }
    } catch (error) {
      if (isCliError(error)) throw error
      throw new CliError("configuration_error", "could not open the shared meeting store")
    }
  }
  const connected = (intent: StoreConnectRequest["intent"] = "read") => (connecting ??= openStore(intent))
  const zones = new ZoneAssumptions()
  const ask = () => (program.opts().input === false ? undefined : deps.confirm)
  const maxOutputBytes = () => {
    const value = program.opts().maxOutputBytes
    return value === undefined ? undefined : Number(value)
  }
  const formatOf = (): AnswerFormat =>
    program.opts().jsonl ? "jsonl" : program.opts().json || !deps.outputIsTTY ? "json" : "pretty"
  const rendered = (body: Body, format = formatOf(), selectFields = true) => {
    if (
      progress &&
      "item" in body &&
      body.item &&
      typeof body.item === "object" &&
      "meetings" in body.item &&
      "warnings" in body.item
    )
      progress.complete(body.item as import("@wirecat/cli-core/meetings").RunReport)
    if (!execution) throw new CliError("configuration_error", "command execution is not initialized")
    const answer = renderBody(execution.action, body, {
      format,
      warnings: zones.take(),
      meta: execution.meta(),
      fields: selectFields ? fields : undefined,
      quiet: Boolean(program.opts().quiet),
      diagnostic: deps.diagnostic,
    })
    const exit = environmentOf(program).exit
    if (exit) exit.code = Math.max(exit.code ?? 0, answer.exitCode)
    return answer.text
  }
  const api = () => {
    if (program.opts().offline)
      throw new CliError("configuration_error", "the command requires network access; remove --offline")
    if (!getConfig().clientId)
      throw new CliError("configuration_error", "run zm config set zoom.client_id <Public Client ID> first")
  }
  let activeAction = program
  program.hook("preAction", (_root, action) => {
    activeAction = action
    const timeout = program.opts().timeout
    if (timeout !== undefined) duration(timeout, "--timeout")
    else if (commandDeadline(action) === 3600000) program.setOptionValue("timeout", "1h")
  })
  lifecycle.prepare = async () => {
    const action = activeAction
    const flags = action.optsWithGlobals()
    for (const option of action.options) {
      const key = option.attributeName()
      if (action.getOptionValue(key) === undefined && flags[key] !== undefined) action.setOptionValue(key, flags[key])
    }
    fields = program.opts().fields === undefined ? undefined : fieldsOf(program.opts().fields)
    if (deps.atStart) await deps.atStart(action)
    const asking = guardCommand(action, deps.env ?? process.env, { profile: named, config: getConfig }, ask())
    if (asking) await asking
    const opts = action.optsWithGlobals()
    if (opts.json && opts.jsonl) throw new CliError("validation_error", "choose --json or --jsonl")
    execution = sharedExecution(action, environmentOf(program), deps.now)
    checkCancelled(signal())
    if (
      (action.parent?.name() === "meetings" && ["sync", "import"].includes(action.name())) ||
      action.name() === "watch"
    ) {
      const selected = named()
      if (selected) {
        progress = meetingProgress(selected, deps.env ?? process.env, deps.now)
        progress.begin()
      }
    }
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
  }
  const output = (body: Body) => buffer(rendered(body))
  const outputItems = async (values: AsyncIterable<unknown>) => {
    const items: unknown[] = []
    // Fails on the row that crosses --max-output-bytes, so a long iterator stops reading there.
    const measured = createOutputBuffer({ maxOutputBytes: maxOutputBytes() })
    for await (const value of values) {
      checkCancelled(signal())
      const item = snakeKeys(value)
      measured.data(JSON.stringify(fields ? projectFields(item, fields) : item))
      items.push(item)
    }
    output(wholeList("list", items))
  }
  addConfigCommands(program, { configPath: deps.configPath, getConfig, output, profile })
  const fetchApi = () => fetchWithSignal(deps.fetch)
  const configured = configuredMeetingSource({ deps, getConfig, tokens, fetch: fetchApi, zones })
  const source = configured.source
  const meetingCommands: Parameters<typeof addZoomMeetingCommands>[1] = {
    get store() {
      return guardedStore(selectedStore ?? unavailableStore)
    },
    get accountId() {
      return requireAccount()
    },
    source,
    importHelp: fileNamesHelp(() => getConfig()),
    readFiles: async (folder) => {
      const config = getConfig()
      return validateDownloadedFiles(await (deps.readFiles ?? readDownloadedFiles)(folder), filesZone(config)).map(
        (file) => importFile(file, requireAccount(), filesZone(config)),
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
    api,
    profile,
    tokens,
    fetch: () => fetchWithSignal(deps.fetch),
    signal,
  })
  const watch = createWatchService({
    deps,
    getConfig,
    profile,
    tokens,
    fetch: () => fetchWithSignal(deps.fetch),
    offline: () => Boolean(program.opts().offline),
    openStore,
    guardedStore,
    zones,
  })
  const receipt = async (body: Body) => {
    const text = rendered(body)
    const operation = signal() as AbortSignal
    const grace = operation.aborted ? createDeadline({ timeoutMs: 1000 }) : undefined
    try {
      await emitReceipt(text, maxOutputBytes(), async (serialized) => {
        if (deps.streamData) await deps.streamData(serialized, grace?.signal ?? operation)
        else given.data(serialized)
      })
    } catch (error) {
      checkCancelled(operation)
      throw error
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
    account: () => profileAccountKey(profile()),
    signal,
    now: deps.now ?? Date.now,
    recordings: () =>
      deps.recordings ?? new ZoomRecordings(tokens(), fetchWithSignal(deps.fetch), remoteOptions, zones),
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
    ...zoomRecordingSchedule({ deps, getConfig, profile, withSignal: fetchWithSignal, signal, remoteOptions, zones }),
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
      capturedContext ??= captureContextSources(getConfig().contextSources, profile())
      return capturedContext
    },
    credentials: () => {
      api()
      return tokens()
    },
    fetch: fetchWithSignal(deps.fetch),
    remoteOptions,
  }
  addZoomInventoryCommand(program, {
    profile,
    ...preparationOptions,
    signal,
    now: deps.now,
    output: (value) => output(bodyOf(value)),
  })
  addMcpCommands(program, {
    profile,
    permissions: (name) =>
      discoveryLevels(readConfig(deps.configPath).permissions[name] ?? {}, deps.env ?? process.env),
    run: (argv, environment) => runForAgent(execute, argv, given, environment),
    signal,
    serve: deps.serveMcp,
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
  addProgressCommands(program, { profile, env: deps.env ?? process.env, now: deps.now, output })
  declareZoomAnswers(program)
  annotateMeetingCommands(program)
  installFirstScreen(program)
  program.hook("postAction", async () => {
    if (connecting) {
      const closing = connecting
      connecting = undefined
      try {
        await (await closing)?.close()
      } catch {
        throw new CliError("configuration_error", "could not close the shared meeting store")
      }
    }
    checkCancelled(signal())
    execution?.output.flush(given.data)
    execution = undefined
  })
}
