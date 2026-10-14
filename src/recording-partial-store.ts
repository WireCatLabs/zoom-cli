import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { type FileHandle, lstat, open, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { CliError } from "@wirecat/cli-base"
import { openOrdinaryFile, syncDirectory } from "@wirecat/cli-core/files"
import type {
  RecordingAssetLocator,
  RecordingPartial,
  RecordingTransferStorage,
  RecordingTransferWriter,
} from "@wirecat/cli-core/meetings"
import { checkCancelled } from "./errors.js"

const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const identity = (locator: RecordingAssetLocator) =>
  JSON.stringify([locator.provider, locator.account, locator.occurrenceId, locator.assetId])
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
const fingerprint = async (file: FileHandle, signal?: AbortSignal, length?: number) => {
  checkCancelled(signal)
  const hash = createHash("sha256")
  let size = 0
  const buffer = Buffer.alloc(65536)
  for (;;) {
    checkCancelled(signal)
    const wanted = length === undefined ? buffer.length : Math.min(buffer.length, length - size)
    if (wanted === 0) break
    const count = (await file.read(buffer, 0, wanted, size)).bytesRead
    if (count === 0) break
    size += count
    hash.update(buffer.subarray(0, count))
  }
  return { offset: size, sha256: hash.copy().digest("hex"), hash }
}
/** The caller holds the archive lease throughout load, open and promotion. */
export class RecordingPartialStore implements RecordingTransferStorage {
  readonly path: string
  completed: RecordingPartial | null = null
  private readonly metadataPath: string
  constructor(
    private readonly root: string,
    private readonly locator: RecordingAssetLocator,
    private readonly signal?: AbortSignal,
    private readonly persistent = true,
    private readonly maxBytes = 20 * 1024 ** 3,
  ) {
    this.locator = Object.freeze({
      provider: locator.provider,
      account: locator.account,
      occurrenceId: locator.occurrenceId,
      assetId: locator.assetId,
    })
    const key = persistent ? digest(identity(this.locator)) : randomUUID()
    this.path = join(root, `.zoom-partial-${key}.part`)
    this.metadataPath = join(root, `.zoom-partial-${key}.json`)
  }
  async load(locator: RecordingAssetLocator): Promise<RecordingPartial | null> {
    if (identity(locator) !== identity(this.locator))
      throw new CliError("validation_error", "recording partial scope changed")
    checkCancelled(this.signal)
    if (!this.persistent) return null
    let metadata: FileHandle
    try {
      metadata = await openOrdinaryFile(this.metadataPath)
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
    let value: RecordingPartial
    try {
      if ((await metadata.stat()).size > 16384) throw new Error("metadata limit")
      const bytes = Buffer.alloc(16385)
      const count = (await metadata.read(bytes, 0, bytes.length, 0)).bytesRead
      if (count > 16384) throw new Error("metadata limit")
      value = JSON.parse(bytes.subarray(0, count).toString("utf8")) as RecordingPartial
      if (
        Object.keys(value).some((key) => !["locator", "offset", "sha256", "validator", "total"].includes(key)) ||
        identity(value.locator) !== identity(locator) ||
        Object.keys(value.locator).some((key) => !["provider", "account", "occurrenceId", "assetId"].includes(key)) ||
        !Number.isSafeInteger(value.offset) ||
        value.offset < 0 ||
        value.offset > this.maxBytes ||
        !/^[a-f0-9]{64}$/.test(value.sha256)
      )
        throw new Error("metadata shape")
    } catch {
      throw new CliError("validation_error", "recording partial metadata is invalid")
    } finally {
      await metadata.close()
    }
    const file = await openOrdinaryFile(this.path)
    try {
      const actual = await fingerprint(file, this.signal, value.offset)
      if (actual.offset !== value.offset || actual.sha256 !== value.sha256)
        throw new CliError("validation_error", "recording partial checksum does not match")
      return value
    } finally {
      await file.close()
    }
  }
  async open(
    locator: RecordingAssetLocator,
    options: { resume?: RecordingPartial; validator: string | null; total: number | null },
  ): Promise<RecordingTransferWriter> {
    if (identity(locator) !== identity(this.locator))
      throw new CliError("validation_error", "recording partial scope changed")
    checkCancelled(this.signal)
    let file: FileHandle
    if (options.resume) {
      const witness = await openOrdinaryFile(this.path)
      try {
        file = await open(
          this.path,
          constants.O_RDWR |
            (process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)),
        )
        const a = await witness.stat({ bigint: true })
        const b = await file.stat({ bigint: true })
        const after = await lstat(this.path, { bigint: true })
        if (!b.isFile() || !after.isFile() || a.ino !== b.ino || a.dev !== b.dev || after.ino !== a.ino) {
          await file.close()
          throw new CliError("validation_error", "recording partial changed while opening")
        }
      } finally {
        await witness.close()
      }
    } else {
      // Replace the owned partial name atomically without following an existing symlink.
      const temp = join(this.root, `.zoom-partial-${randomUUID()}.tmp`)
      file = await open(temp, "wx+", 0o600)
      try {
        await rename(temp, this.path)
        await unlink(this.metadataPath).catch((error) => {
          if (!missing(error)) throw error
        })
      } catch (error) {
        await file.close()
        await unlink(temp).catch(() => undefined)
        throw error
      }
    }
    let prefix: Awaited<ReturnType<typeof fingerprint>>
    try {
      prefix = await fingerprint(file, this.signal, options.resume?.offset)
      if (options.resume && (prefix.offset !== options.resume.offset || prefix.sha256 !== options.resume.sha256))
        throw new CliError("validation_error", "recording partial changed before append")
    } catch (error) {
      await file.close()
      throw error
    }
    if (options.resume && (await file.stat()).size > prefix.offset) await file.truncate(prefix.offset)
    let size = prefix.offset
    const hash = prefix.hash
    const checkpoint = async () => {
      await file.sync()
      if (!options.validator || !this.persistent) {
        await syncDirectory(this.root)
        return
      }
      const value: RecordingPartial = {
        locator: {
          provider: locator.provider,
          account: locator.account,
          occurrenceId: locator.occurrenceId,
          assetId: locator.assetId,
        },
        offset: size,
        sha256: hash.copy().digest("hex"),
        validator: options.validator,
        total: options.total,
      }
      const content = JSON.stringify(value)
      if (Buffer.byteLength(content) > 16384)
        throw new CliError("validation_error", "recording partial metadata exceeds its byte limit")
      const temp = join(this.root, `.zoom-partial-${randomUUID()}.tmp`)
      const metadata = await open(temp, "wx", 0o600)
      try {
        try {
          await metadata.writeFile(content)
          await metadata.sync()
        } finally {
          await metadata.close()
        }
        await rename(temp, this.metadataPath)
        await syncDirectory(this.root)
      } finally {
        await unlink(temp).catch(() => undefined)
      }
    }
    return {
      write: async (bytes) => {
        let offset = 0
        while (offset < bytes.length) {
          const written = (await file.write(bytes, offset, bytes.length - offset, size + offset)).bytesWritten
          if (written === 0) throw new CliError("configuration_error", "recording partial write did not progress")
          offset += written
        }
        hash.update(bytes)
        size += bytes.length
      },
      checkpoint,
      finish: async () => {
        await checkpoint()
        this.completed = options.validator
          ? {
              locator: { ...this.locator },
              offset: size,
              sha256: hash.copy().digest("hex"),
              validator: options.validator,
              total: options.total,
            }
          : null
        return { size, sha256: hash.copy().digest("hex") }
      },
      close: () => file.close(),
    }
  }
}
