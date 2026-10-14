import { createHash, randomUUID } from "node:crypto"
import { open, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { CliError } from "@wirecat/cli-base"
import { openOrdinaryFile, syncDirectory } from "@wirecat/cli-core/files"
import { type RecordingAssetLocator, type RecordingPartial, strongRecordingValidator } from "@wirecat/cli-core/meetings"
import type { ArchivedFile, ArchiveManifest } from "./recording-archive.js"

export interface RecordingPromotion {
  version: 1
  locator: RecordingAssetLocator
  meeting: ArchiveManifest["meeting"]
  file: ArchivedFile
  validator: string
}
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
const scope = (locator: RecordingAssetLocator) => [
  locator.provider,
  locator.account,
  locator.occurrenceId,
  locator.assetId,
]
const name = (root: string, locator: RecordingAssetLocator) =>
  join(
    root,
    `.zoom-promotion-${createHash("sha256")
      .update(JSON.stringify(scope(locator)))
      .digest("hex")}.json`,
  )
const keys = (value: object, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key))
export const writeRecordingPromotion = async (
  root: string,
  locator: RecordingAssetLocator,
  meeting: ArchiveManifest["meeting"],
  file: ArchivedFile,
  completed: RecordingPartial,
) => {
  const record: RecordingPromotion = {
    version: 1,
    locator: {
      provider: locator.provider,
      account: locator.account,
      occurrenceId: locator.occurrenceId,
      assetId: locator.assetId,
    },
    meeting: { ...meeting },
    file: { ...file },
    validator: completed.validator,
  }
  const content = JSON.stringify(record)
  if (Buffer.byteLength(content) > 32768)
    throw new CliError("validation_error", "recording recovery record exceeds its metadata limit")
  const temp = join(root, `.zoom-promotion-${randomUUID()}.tmp`)
  const handle = await open(temp, "wx", 0o600)
  try {
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, name(root, locator))
    await syncDirectory(root)
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}
export const readRecordingPromotion = async (
  root: string,
  locator: RecordingAssetLocator,
  meeting: ArchiveManifest["meeting"],
  expected: Omit<ArchivedFile, "size" | "sha256">,
): Promise<RecordingPromotion | null> => {
  let handle: Awaited<ReturnType<typeof openOrdinaryFile>>
  try {
    handle = await openOrdinaryFile(name(root, locator))
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  try {
    const buffer = Buffer.alloc(32769)
    const count = (await handle.read(buffer, 0, buffer.length, 0)).bytesRead
    if (count > 32768) throw new Error("metadata limit")
    const record = JSON.parse(buffer.subarray(0, count).toString("utf8")) as RecordingPromotion
    if (
      record.version !== 1 ||
      !keys(record, ["version", "locator", "meeting", "file", "validator"]) ||
      !keys(record.locator, ["provider", "account", "occurrenceId", "assetId"]) ||
      JSON.stringify(scope(record.locator)) !== JSON.stringify(scope(locator)) ||
      !keys(record.meeting, ["id", "uuid", "title", "startedAt"]) ||
      record.meeting.id !== meeting.id ||
      record.meeting.uuid !== meeting.uuid ||
      record.meeting.title !== meeting.title ||
      record.meeting.startedAt !== meeting.startedAt ||
      !keys(record.file, ["id", "path", "remoteSize", "type", "format", "startedAt", "endedAt", "size", "sha256"]) ||
      Object.entries(expected).some(([key, value]) => record.file[key as keyof ArchivedFile] !== value) ||
      !Number.isSafeInteger(record.file.size) ||
      record.file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(record.file.sha256) ||
      !strongRecordingValidator(record.validator)
    )
      throw new Error("record shape")
    return record
  } catch {
    throw new CliError("validation_error", "recording recovery record does not match this scoped asset")
  } finally {
    await handle.close()
  }
}
