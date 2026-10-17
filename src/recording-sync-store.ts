import { randomUUID } from "node:crypto"
import { chmod, mkdir, realpath } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { CliError, isCliError } from "@wirecat/cli-base"
import { acquireLock, type FileLock, openOrdinaryFile, writeFileAtomic } from "@wirecat/cli-core/files"
import {
  parseRecordingSyncCheckpoint,
  type RecordingSyncCheckpoint,
  type RecordingSyncCheckpointStore,
  type RecordingSyncLease,
} from "@wirecat/cli-core/meetings"

const maxBytes = 8 * 1024 ** 2
const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code
const conflict = (message: string): never => {
  throw new CliError("configuration_error", message)
}
const boundedJson = async (path: string, limit: number): Promise<unknown> => {
  const file = await openOrdinaryFile(path)
  try {
    const size = (await file.stat()).size
    if (size > limit) throw new CliError("validation_error", "archive checkpoint exceeds its byte limit")
    const content = Buffer.alloc(size + 1)
    const { bytesRead } = await file.read(content, 0, content.length, 0)
    if (bytesRead !== size || bytesRead > limit)
      throw new CliError("validation_error", "archive checkpoint changed while reading")
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content.subarray(0, bytesRead)))
    } catch {
      throw new CliError("validation_error", "archive checkpoint contains invalid JSON")
    }
  } finally {
    await file.close()
  }
}
export function fileRecordingSyncCheckpointStore(path: string): RecordingSyncCheckpointStore {
  if (typeof path !== "string" || !path.trim())
    throw new CliError("validation_error", "archive checkpoint path is required")
  const checkpointPath = resolve(path)
  // Not the old `.lock`: a directory left there by an older zm holds an owner.json the new lock reads as a holder.
  const lockPath = `${checkpointPath}.locks`
  const leases = new Map<string, { jobId: string; lock: FileLock }>()
  const own = async (jobId: string, token: string): Promise<void> => {
    const held = leases.get(token)
    if (!held || held.jobId !== jobId) return conflict("archive checkpoint lease is not owned")
    if (!(await held.lock.held())) return conflict("archive checkpoint lease changed")
  }
  const lock = async (): Promise<FileLock> => {
    try {
      // acquireLock makes its folder with the default mode; the checkpoint lock has always been private.
      await mkdir(lockPath, { recursive: true, mode: 0o700 })
      const held = await acquireLock(lockPath)
      await chmod(lockPath, 0o700)
      return held
    } catch (error) {
      if (isCliError(error) && error.details.reason === "file.locked")
        return conflict("archive checkpoint job is already active or owned by another host")
      if (isCliError(error)) return conflict(error.message)
      if (code(error) === "EEXIST" || code(error) === "ENOTDIR")
        return conflict("archive checkpoint lock must be an ordinary directory")
      throw error
    }
  }
  const read = async (): Promise<RecordingSyncCheckpoint | null> => {
    try {
      return parseRecordingSyncCheckpoint(await boundedJson(checkpointPath, maxBytes))
    } catch (error) {
      if (code(error) === "ENOENT") return null
      throw error
    }
  }
  return {
    async acquire(jobId): Promise<RecordingSyncLease> {
      if (typeof jobId !== "string" || !jobId.trim() || jobId.length > 4096)
        throw new CliError("validation_error", "archive checkpoint job id is required")
      await mkdir(dirname(checkpointPath), { recursive: true, mode: 0o700 })
      const held = await lock()
      const token = randomUUID()
      leases.set(token, { jobId, lock: held })
      return {
        token,
        async release() {
          await own(jobId, token)
          await held.release()
          leases.delete(token)
        },
      }
    },
    async read(jobId, token) {
      await own(jobId, token)
      return read()
    },
    async save(jobId, token, expectedRevision, value) {
      await own(jobId, token)
      const state = parseRecordingSyncCheckpoint(value)
      const current = await read()
      if ((current?.revision ?? null) !== expectedRevision || state.revision !== (expectedRevision ?? 0) + 1)
        return conflict("archive checkpoint revision changed")
      const content = JSON.stringify(state)
      if (Buffer.byteLength(content) > maxBytes)
        throw new CliError("validation_error", "archive checkpoint exceeds its byte limit")
      // The real folder: the directory sync after the rename refuses to follow a symlinked archive folder.
      const folder = await realpath(dirname(checkpointPath))
      await writeFileAtomic(join(folder, basename(checkpointPath)), content, {
        beforePublish: () => own(jobId, token),
      })
    },
  }
}
