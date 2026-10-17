import { lstat, mkdir, readdir } from "node:fs/promises"
import { isAbsolute, join, parse, relative, sep } from "node:path"
import { CliError, isCliError } from "@wirecat/cli-base"
import { openOrdinaryFile, writeFileAtomic } from "@wirecat/cli-core/files"
import { checkCancelled } from "./errors.js"
import {
  parseRecordingScheduleJob,
  type RecordingScheduleStore,
  validateRecordingScheduleId,
} from "./recording-schedule.js"

const maximumBytes = 32 * 1024
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
export const recordingScheduleDirectory = async (directory: string, create: boolean): Promise<boolean> => {
  if (!isAbsolute(directory) || /[\0\r\n]/.test(directory))
    throw new CliError("validation_error", "archive schedule directory must be absolute")
  const root = parse(directory).root
  let path = root
  for (const segment of relative(root, directory).split(sep).filter(Boolean)) {
    path = join(path, segment)
    try {
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new CliError(
          "validation_error",
          "archive schedule directories must not contain symlinks or foreign files",
        )
    } catch (error) {
      if (!missing(error)) throw error
      if (!create) return false
      await mkdir(path, { mode: 0o700 }).catch(async (cause) => {
        if (typeof cause !== "object" || cause === null || !("code" in cause) || cause.code !== "EEXIST") throw cause
        const stat = await lstat(path)
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new CliError("validation_error", "archive schedule directory changed while creating it")
      })
    }
  }
  return true
}
const read = async (path: string, signal?: AbortSignal) => {
  checkCancelled(signal)
  let handle: Awaited<ReturnType<typeof openOrdinaryFile>>
  try {
    handle = await openOrdinaryFile(path)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  try {
    const stat = await handle.stat({ bigint: true })
    if (stat.size > BigInt(maximumBytes))
      throw new CliError("validation_error", "archive schedule metadata exceeds its byte limit")
    const bytes = Buffer.alloc(maximumBytes + 1)
    const size = (await handle.read(bytes, 0, bytes.length, 0)).bytesRead
    checkCancelled(signal)
    if (size > maximumBytes) throw new CliError("validation_error", "archive schedule metadata exceeds its byte limit")
    const job = parseRecordingScheduleJob(JSON.parse(bytes.subarray(0, size).toString("utf8")))
    return { job, stat }
  } catch (error) {
    if (isCliError(error)) throw error
    checkCancelled(signal)
    throw new CliError("validation_error", "archive schedule metadata is invalid")
  } finally {
    await handle.close()
  }
}
export const fileRecordingScheduleStore = (directory: string): RecordingScheduleStore => {
  const path = (id: string) => join(directory, `${validateRecordingScheduleId(id)}.json`)
  return {
    async list(options) {
      checkCancelled(options.signal)
      if (!(await recordingScheduleDirectory(directory, false))) return []
      const result = []
      for (const name of (await readdir(directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
        const saved = await read(join(directory, name), options.signal)
        if (!saved || `${saved.job.schedule.id}.json` !== name)
          throw new CliError("validation_error", "archive schedule filename does not match its identity")
        result.push(saved.job)
      }
      return result
    },
    async load(id, options) {
      const target = path(id)
      checkCancelled(options.signal)
      if (!(await recordingScheduleDirectory(directory, false))) return null
      const saved = await read(target, options.signal)
      if (saved && saved.job.schedule.id !== id)
        throw new CliError("validation_error", "archive schedule filename does not match its identity")
      return saved?.job ?? null
    },
    async save(value, options) {
      const job = parseRecordingScheduleJob(value)
      const content = `${JSON.stringify(job)}\n`
      if (Buffer.byteLength(content) > maximumBytes)
        throw new CliError("validation_error", "archive schedule metadata exceeds its byte limit")
      checkCancelled(options.signal)
      await recordingScheduleDirectory(directory, true)
      const target = path(job.schedule.id)
      const existing = await read(target, options.signal)
      if (
        existing &&
        (existing.job.schedule.id !== job.schedule.id ||
          JSON.stringify(existing.job.capture) !== JSON.stringify(job.capture))
      )
        throw new CliError("validation_error", "archive schedule file belongs to another captured job")
      await writeFileAtomic(target, content, {
        overwrite: existing !== null,
        beforePublish: async () => {
          checkCancelled(options.signal)
          if (!existing) return
          const current = await lstat(target, { bigint: true })
          if (
            !current.isFile() ||
            current.isSymbolicLink() ||
            current.ino !== existing.stat.ino ||
            current.size !== existing.stat.size ||
            current.mtimeNs !== existing.stat.mtimeNs ||
            (current.dev !== 0n && current.dev !== existing.stat.dev && process.platform !== "win32")
          )
            throw new CliError("validation_error", "archive schedule file changed before replacement")
        },
      })
    },
  }
}
