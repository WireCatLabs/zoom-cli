import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, rmdir, unlink } from "node:fs/promises"
import { hostname } from "node:os"
import { dirname, join, resolve } from "node:path"
import { CliError } from "@wirecat/cli-base"
import { openOrdinaryFile, writeFileAtomic } from "@wirecat/cli-core/files"
import {
  parseRecordingSyncCheckpoint,
  type RecordingSyncCheckpoint,
  type RecordingSyncCheckpointStore,
  type RecordingSyncLease,
} from "@wirecat/cli-core/meetings"

const maxBytes = 8 * 1024 ** 2
const ownerByteLimit = 32 * 1024
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
interface Owner {
  version: 1
  pid: number
  host: string
  token: string
  jobId: string
}
const ownerOf = (value: unknown): Owner => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return conflict("archive checkpoint lock is unrecognized")
  const row = value as Partial<Owner>
  if (
    row.version !== 1 ||
    !Number.isSafeInteger(row.pid) ||
    Number(row.pid) <= 0 ||
    typeof row.host !== "string" ||
    !row.host ||
    typeof row.token !== "string" ||
    !/^[a-f0-9-]{36}$/.test(row.token) ||
    typeof row.jobId !== "string" ||
    !row.jobId
  )
    return conflict("archive checkpoint lock is unrecognized")
  return row as Owner
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return code(error) !== "ESRCH"
  }
}
export function fileRecordingSyncCheckpointStore(path: string): RecordingSyncCheckpointStore {
  if (typeof path !== "string" || !path.trim())
    throw new CliError("validation_error", "archive checkpoint path is required")
  const checkpointPath = resolve(path)
  // Published writers use owner.json and .lock.recovery; changing this protocol permits concurrent owners.
  const lockPath = `${checkpointPath}.lock`
  const marker = join(lockPath, "owner.json")
  const recoveryPath = `${lockPath}.recovery`
  const owners = new Map<string, Owner>()
  const readOwner = async (): Promise<Owner> => {
    try {
      return ownerOf(await boundedJson(marker, ownerByteLimit))
    } catch {
      return conflict("archive checkpoint lock is missing, incomplete or unrecognized")
    }
  }
  const own = async (jobId: string, token: string): Promise<void> => {
    const held = owners.get(token)
    if (!held || held.jobId !== jobId) return conflict("archive checkpoint lease is not owned")
    const actual = await readOwner()
    if (actual.token !== token || actual.jobId !== jobId || actual.host !== held.host || actual.pid !== held.pid)
      return conflict("archive checkpoint lease changed")
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
      try {
        await mkdir(lockPath, { mode: 0o700 })
      } catch (error) {
        if (code(error) !== "EEXIST") throw error
        const folder = await lstat(lockPath)
        if (!folder.isDirectory() || folder.isSymbolicLink())
          return conflict("archive checkpoint lock must be an ordinary directory")
        try {
          await mkdir(recoveryPath, { mode: 0o700 })
        } catch (error) {
          if (code(error) === "EEXIST") return conflict("archive checkpoint recovery is already active")
          throw error
        }
        try {
          const prior = await readOwner()
          if (prior.host !== hostname() || alive(prior.pid))
            return conflict("archive checkpoint job is already active or owned by another host")
          const verified = await readOwner()
          if (verified.token !== prior.token) return conflict("archive checkpoint lock changed during stale recovery")
          await unlink(marker)
          await rmdir(lockPath)
          await mkdir(lockPath, { mode: 0o700 })
        } finally {
          await rmdir(recoveryPath)
        }
      }
      const owner: Owner = { version: 1, pid: process.pid, host: hostname(), token: randomUUID(), jobId }
      const file = await open(marker, "wx", 0o600)
      try {
        await file.writeFile(JSON.stringify(owner))
        await file.sync()
      } finally {
        await file.close()
      }
      owners.set(owner.token, owner)
      return {
        token: owner.token,
        async release() {
          await own(jobId, owner.token)
          await unlink(marker)
          await rmdir(lockPath)
          owners.delete(owner.token)
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
      await writeFileAtomic(checkpointPath, content, {
        beforePublish: () => own(jobId, token),
      })
    },
  }
}

export const inspectRecordingSyncCheckpoint = async (path: string): Promise<RecordingSyncCheckpoint | null> => {
  try {
    return parseRecordingSyncCheckpoint(await boundedJson(path, maxBytes))
  } catch (error) {
    if (code(error) === "ENOENT") return null
    throw error
  }
}
