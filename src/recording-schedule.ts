import { isAbsolute } from "node:path"
import { CliError } from "@wirecat/cli-base"
import {
  installRecordingArchiveSchedule,
  parseRecordingArchiveSchedule,
  planRecordingArchiveSchedule,
  type RecordingArchiveSchedule,
  recordingArchiveScheduleWindow,
} from "@wirecat/cli-core/meetings"
import { profileAccountKey } from "./config.js"
import { checkCancelled } from "./errors.js"
import { type ArchiveSyncReceipt, syncRecordingArchive } from "./recording-sync.js"
import type { ZoomRecordings } from "./recordings.js"

export interface RecordingScheduleCapture {
  profile: string
  clientId: string
  configDir: string
  runtime: string
  cliPath: string
}
export interface RecordingScheduleJob {
  version: 1
  schedule: RecordingArchiveSchedule
  capture: RecordingScheduleCapture
  state: "pending" | "enabled" | "disabled"
}
export interface RecordingScheduleStore {
  list(options: { signal?: AbortSignal }): Promise<RecordingScheduleJob[]>
  load(id: string, options: { signal?: AbortSignal }): Promise<RecordingScheduleJob | null>
  save(job: RecordingScheduleJob, options: { signal?: AbortSignal }): Promise<void>
}
export interface RecordingScheduleUnits {
  serviceName: string
  timerName: string
  service: string
  timer: string
}
export interface RecordingScheduleBackend {
  readonly backend: string
  plan(job: RecordingScheduleJob): RecordingScheduleUnits
  assertSupported(): void
  install(job: RecordingScheduleJob, options: { signal?: AbortSignal }): Promise<void>
  disable(job: RecordingScheduleJob, options: { signal?: AbortSignal }): Promise<void>
}
export interface RecordingScheduleCreateInput {
  name: string
  destination: string
  from: string
  dailyAt: string
  timeZone: string
  lookbackDays?: number
  maxBytes?: number
}
export interface RecordingScheduleReceipt {
  applied: boolean
  backend: string
  job: RecordingScheduleJob
  units?: RecordingScheduleUnits
  timerState: "not_checked" | "verified_enabled" | "verified_disabled"
}
export interface RecordingScheduleService {
  create(
    input: RecordingScheduleCreateInput,
    capture: RecordingScheduleCapture,
    options?: { apply?: boolean; dryRun?: boolean; offline?: boolean; signal?: AbortSignal },
  ): Promise<RecordingScheduleReceipt>
  list(options?: { signal?: AbortSignal }): Promise<RecordingScheduleJob[]>
  show(id: string, options?: { signal?: AbortSignal }): Promise<RecordingScheduleJob>
  run(id: string, options?: { offline?: boolean; signal?: AbortSignal }): AsyncIterable<ArchiveSyncReceipt>
  disable(
    id: string,
    options?: { apply?: boolean; dryRun?: boolean; signal?: AbortSignal },
  ): Promise<RecordingScheduleReceipt>
}
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= limit && !/[\0\r\n]/.test(value)
const absolute = (value: unknown): value is string => text(value, 4096) && isAbsolute(value)
export const validateRecordingScheduleId = (id: string): string => {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
    throw new CliError("validation_error", "archive schedule id must be 64 lowercase hexadecimal characters")
  return id
}
export const snapshotRecordingScheduleCapture = (
  value: RecordingScheduleCapture,
): Readonly<RecordingScheduleCapture> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CliError("validation_error", "archive schedule capture is invalid")
  const { profile, clientId, configDir, runtime, cliPath } = value
  if (
    !text(profile, 64) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile) ||
    !text(clientId, 200) ||
    /\s/.test(clientId) ||
    !absolute(configDir) ||
    !absolute(runtime) ||
    !absolute(cliPath)
  )
    throw new CliError(
      "validation_error",
      "archive schedule requires a profile, public client id and absolute config/runtime/CLI paths",
    )
  return Object.freeze({ profile, clientId, configDir, runtime, cliPath })
}
export const parseRecordingScheduleJob = (value: unknown): RecordingScheduleJob => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CliError("validation_error", "archive schedule job is invalid")
  const row = value as RecordingScheduleJob
  if (
    row.version !== 1 ||
    Object.keys(row).some((key) => !["version", "schedule", "capture", "state"].includes(key)) ||
    !["pending", "enabled", "disabled"].includes(row.state)
  )
    throw new CliError("validation_error", "archive schedule job is invalid")
  const capture = snapshotRecordingScheduleCapture(row.capture)
  if (Object.keys(row.capture).some((key) => !["profile", "clientId", "configDir", "runtime", "cliPath"].includes(key)))
    throw new CliError("validation_error", "archive schedule capture is invalid")
  const schedule = parseRecordingArchiveSchedule(row.schedule)
  if (
    schedule.scope.provider !== "zoom" ||
    schedule.scope.account !== profileAccountKey(capture.profile) ||
    !absolute(schedule.destination)
  )
    throw new CliError("validation_error", "archive schedule capture does not match its provider scope")
  const job = Object.freeze({ version: 1 as const, schedule, capture, state: row.state })
  if (Buffer.byteLength(JSON.stringify(job)) > 32 * 1024)
    throw new CliError("validation_error", "archive schedule metadata exceeds its byte limit")
  return job
}
export const createRecordingScheduleService = (deps: {
  store: RecordingScheduleStore
  backend: RecordingScheduleBackend
  recordings: (job: RecordingScheduleJob) => Pick<ZoomRecordings, "download" | "catalog">
  now?: () => number
}): RecordingScheduleService => {
  const show = async (id: string, options: { signal?: AbortSignal } = {}) => {
    validateRecordingScheduleId(id)
    checkCancelled(options.signal)
    const found = await deps.store.load(id, options)
    if (!found) throw new CliError("not_found", "archive schedule was not found")
    const job = parseRecordingScheduleJob(found)
    if (job.schedule.id !== id)
      throw new CliError("validation_error", "archive schedule storage returned a different job")
    return job
  }
  return {
    async create(input, context, options = {}) {
      options = { ...options }
      checkCancelled(options.signal)
      const capture = snapshotRecordingScheduleCapture(context)
      const schedule = planRecordingArchiveSchedule(
        { ...input, scope: { provider: "zoom", account: profileAccountKey(capture.profile) } },
        { now: deps.now?.() ?? Date.now() },
      )
      const job = parseRecordingScheduleJob({ version: 1, schedule, capture, state: "pending" })
      const backend = deps.backend.backend
      const units = deps.backend.plan(job)
      if (options.apply !== true || options.dryRun === true)
        return { applied: false, backend, job, units, timerState: "not_checked" }
      if (options.offline)
        throw new CliError("configuration_error", "archive schedule installation requires online mode")
      deps.backend.assertSupported()
      const existing = await deps.store.load(schedule.id, { signal: options.signal })
      if (existing && JSON.stringify(parseRecordingScheduleJob(existing).capture) !== JSON.stringify(capture))
        throw new CliError(
          "validation_error",
          "archive schedule id belongs to a different captured runtime or client; choose a new name",
        )
      await deps.store.save(job, { signal: options.signal })
      await installRecordingArchiveSchedule(
        { backend, install: async (_, active) => deps.backend.install(job, active) },
        schedule,
        { apply: true, signal: options.signal },
      )
      const enabled = parseRecordingScheduleJob({ ...job, state: "enabled" })
      await deps.store.save(enabled, {})
      return { applied: true, backend, job: enabled, units, timerState: "verified_enabled" }
    },
    async list(options = {}) {
      checkCancelled(options.signal)
      return (await deps.store.list(options)).map(parseRecordingScheduleJob)
    },
    show,
    async *run(id, options = {}) {
      options = { ...options }
      if (options.offline) throw new CliError("configuration_error", "archive schedule run requires online mode")
      const job = await show(id, { signal: options.signal })
      const window = recordingArchiveScheduleWindow(job.schedule, { now: deps.now?.() ?? Date.now() })
      if (!window) return
      const recordings = deps.recordings(job)
      yield* syncRecordingArchive(recordings, {
        ...window,
        destination: job.schedule.destination,
        maxBytes: job.schedule.maxBytes,
        account: job.schedule.scope.account,
        resume: true,
        signal: options.signal,
        now: deps.now,
      })
    },
    async disable(id, options = {}) {
      options = { ...options }
      const job = await show(id, { signal: options.signal })
      const backend = deps.backend.backend
      if (options.apply !== true || options.dryRun === true)
        return { applied: false, backend, job, timerState: "not_checked" }
      deps.backend.assertSupported()
      await deps.backend.disable(job, { signal: options.signal })
      const disabled = parseRecordingScheduleJob({ ...job, state: "disabled" })
      await deps.store.save(disabled, {})
      return { applied: true, backend, job: disabled, timerState: "verified_disabled" }
    },
  }
}
