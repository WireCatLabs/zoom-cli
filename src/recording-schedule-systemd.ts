import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { link, open, unlink } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { checkCancelled, ZoomError } from "./errors.js"
import { openOrdinaryFile, syncDirectory } from "./ordinary-file.js"
import {
  parseRecordingScheduleJob,
  type RecordingScheduleBackend,
  type RecordingScheduleJob,
  type RecordingScheduleUnits,
} from "./recording-schedule.js"
import { recordingScheduleDirectory } from "./recording-schedule-store.js"

export type RecordingScheduleExecutor = (
  executable: string,
  args: readonly string[],
  options: { shell: false; signal?: AbortSignal },
) => Promise<{ exitCode: number }>
const execute: RecordingScheduleExecutor = (executable, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      { shell: false, signal: options.signal, timeout: 30000, maxBuffer: 65536, encoding: "utf8" },
      (error) => {
        if (!error) return resolve({ exitCode: 0 })
        if (typeof error.code === "number") return resolve({ exitCode: error.code })
        if (error.code === "ENOENT") return reject(new ZoomError("configuration_error", "systemctl is unavailable"))
        reject(
          new ZoomError(
            "outcome_unknown",
            "archive timer command was interrupted; inspect its saved pending job and systemctl status",
          ),
        )
      },
    )
  })
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
const quote = (value: string, expandDollar: boolean) =>
  `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", () => (expandDollar ? "$$" : "$"))
    .replaceAll("\t", "\\t")}"`
const unitPlan = (value: RecordingScheduleJob): RecordingScheduleUnits => {
  const job = parseRecordingScheduleJob(value)
  const name = `zm-archive-${job.schedule.id}`
  const serviceName = `${name}.service`
  const timerName = `${name}.timer`
  const owner = `# WireCat Zoom archive ${job.schedule.id}`
  const args = [
    job.capture.runtime,
    job.capture.cliPath,
    "recordings",
    "schedule",
    "run",
    job.schedule.id,
    "--jsonl",
    "--timeout",
    "6h",
    "--no-input",
  ]
  const timeZone = new Intl.DateTimeFormat("en", { timeZone: job.schedule.timeZone }).resolvedOptions().timeZone
  return {
    serviceName,
    timerName,
    service: `${owner}\n[Unit]\nDescription=WireCat Zoom recording archive\n\n[Service]\nType=oneshot\nUMask=0077\nTimeoutStartSec=6h\nEnvironment=${quote(`ZM_CONFIG_DIR=${job.capture.configDir}`, false)}\nExecStart=${args.map((value) => quote(value, true)).join(" ")}\n`,
    timer: `${owner}\n[Unit]\nDescription=WireCat Zoom recording archive timer\n\n[Timer]\nOnCalendar=*-*-* ${job.schedule.dailyAt}:00 ${timeZone}\nPersistent=true\nUnit=${serviceName}\n\n[Install]\nWantedBy=timers.target\n`,
  }
}
const maximumUnitBytes = 64 * 1024
const existingUnit = async (path: string): Promise<string | null> => {
  let handle: Awaited<ReturnType<typeof openOrdinaryFile>>
  try {
    handle = await openOrdinaryFile(path)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  try {
    const bytes = Buffer.alloc(maximumUnitBytes + 1)
    const size = (await handle.read(bytes, 0, bytes.length, 0)).bytesRead
    if (size > maximumUnitBytes) throw new ZoomError("validation_error", "archive timer unit exceeds its byte limit")
    return bytes.subarray(0, size).toString("utf8")
  } finally {
    await handle.close()
  }
}
const writeUnit = async (directory: string, name: string, content: string, signal?: AbortSignal) => {
  if (Buffer.byteLength(content) > maximumUnitBytes)
    throw new ZoomError("validation_error", "archive timer unit exceeds its byte limit")
  const path = join(directory, name)
  const current = await existingUnit(path)
  if (current !== null) {
    if (current !== content)
      throw new ZoomError("validation_error", "archive timer unit is foreign or was edited; it was preserved")
    await syncDirectory(directory)
    return
  }
  checkCancelled(signal)
  const temp = join(directory, `.zoom-schedule-unit-${randomUUID()}.tmp`)
  const handle = await open(temp, "wx", 0o600)
  try {
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    checkCancelled(signal)
    await link(temp, path)
    await syncDirectory(directory)
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}
export const createSystemdRecordingArchiveScheduler = (options: {
  unitDirectory: string
  platform?: NodeJS.Platform
  execute?: RecordingScheduleExecutor
  systemctl?: string
}): RecordingScheduleBackend => {
  const directory = options.unitDirectory
  const executable = options.systemctl ?? "/usr/bin/systemctl"
  const platform = options.platform ?? process.platform
  const executor = options.execute ?? execute
  if (!isAbsolute(directory) || !isAbsolute(executable) || /[\0\r\n]/.test(directory + executable))
    throw new ZoomError("validation_error", "systemd archive paths must be absolute")
  const assertSupported = () => {
    if (platform !== "linux")
      throw new ZoomError(
        "configuration_error",
        "automatic archive scheduling currently supports Linux user systemd only",
      )
  }
  const checked = async (args: string[], expected: number, signal?: AbortSignal) => {
    checkCancelled(signal)
    let result: Awaited<ReturnType<RecordingScheduleExecutor>>
    try {
      result = await executor(executable, ["--user", ...args], { shell: false, signal })
    } catch (error) {
      if (error instanceof ZoomError) throw error
      throw new ZoomError(
        "outcome_unknown",
        "archive timer command did not acknowledge completion; inspect its saved job and systemctl status",
      )
    }
    if (result.exitCode !== expected)
      throw new ZoomError(
        "outcome_unknown",
        "archive timer state was not verified; inspect its saved job and systemctl status",
      )
  }
  return {
    backend: "systemd-user",
    plan: unitPlan,
    assertSupported,
    async install(value, active) {
      assertSupported()
      const job = parseRecordingScheduleJob(value)
      const units = unitPlan(job)
      checkCancelled(active.signal)
      for (const path of [job.capture.runtime, job.capture.cliPath]) {
        const handle = await openOrdinaryFile(path)
        try {
          const stat = await handle.stat()
          if (path === job.capture.runtime && (stat.mode & 0o111) === 0)
            throw new ZoomError("validation_error", "scheduled runtime must be executable")
        } finally {
          await handle.close()
        }
      }
      await recordingScheduleDirectory(directory, true)
      await writeUnit(directory, units.serviceName, units.service, active.signal)
      await writeUnit(directory, units.timerName, units.timer, active.signal)
      await checked(["daemon-reload"], 0, active.signal)
      await checked(["enable", "--now", units.timerName], 0, active.signal)
      await checked(["is-enabled", "--quiet", units.timerName], 0, active.signal)
      await checked(["is-active", "--quiet", units.timerName], 0, active.signal)
    },
    async disable(value, active) {
      assertSupported()
      const units = unitPlan(value)
      checkCancelled(active.signal)
      if (!(await recordingScheduleDirectory(directory, false)))
        throw new ZoomError("not_found", "archive timer units were not found")
      if (
        (await existingUnit(join(directory, units.serviceName))) !== units.service ||
        (await existingUnit(join(directory, units.timerName))) !== units.timer
      )
        throw new ZoomError("validation_error", "archive timer units are foreign or were edited; they were preserved")
      await checked(["disable", "--now", units.timerName], 0, active.signal)
      await checked(["is-enabled", "--quiet", units.timerName], 1, active.signal)
      await checked(["is-active", "--quiet", units.timerName], 3, active.signal)
    },
  }
}
