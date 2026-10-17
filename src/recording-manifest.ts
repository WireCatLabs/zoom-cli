import { createHash } from "node:crypto"
import { type FileHandle, readdir, realpath } from "node:fs/promises"
import { join } from "node:path"
import { CliError, isCliError } from "@wirecat/cli-base"
import { openOrdinaryFile, writeFileAtomic } from "@wirecat/cli-core/files"
import { checkCancelled, string } from "./errors.js"
import type { RecordingAsset, RecordingMeeting } from "./recordings.js"

export interface ArchivedFile {
  id: string
  path: string
  size: number
  sha256: string
  remoteSize: number | null
  type: string
  format: string | null
  startedAt: string | null
  endedAt: string | null
}
export interface ArchiveManifest {
  version: 1
  meeting: Omit<RecordingMeeting, "assets">
  files: ArchivedFile[]
}
export interface ArchiveVerification {
  manifestPath: string
  id: string
  path: string
  valid: boolean
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex")
export const manifestName = (uuid: string) => `.zoom-archive-${digest(uuid)}.json`
export const filename = (uuid: string, asset: RecordingAsset) =>
  `${digest(uuid)}-${digest(asset.id ?? "")}.${/^(mp4|m4a|mp3|wav|vtt|txt|json)$/i.test(asset.format ?? "") ? asset.format?.toLowerCase() : "bin"}`
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
const localFile = openOrdinaryFile
export const fingerprint = async (
  path: string,
  signal?: AbortSignal,
  maxBytes?: number,
): Promise<{ size: number; sha256: string }> => {
  checkCancelled(signal)
  const file = await localFile(path)
  try {
    checkCancelled(signal)
    const hash = createHash("sha256")
    let size = 0
    for await (const chunk of file.createReadStream({ autoClose: false, ...(signal ? { signal } : {}) })) {
      checkCancelled(signal)
      size += chunk.length
      if (maxBytes !== undefined && size > maxBytes)
        throw new CliError("validation_error", "recording exceeds its verified recovery size")
      hash.update(chunk)
    }
    return { size, sha256: hash.digest("hex") }
  } finally {
    await file.close()
  }
}
/** Size, mtime and checksum seen for each archived file, so a rerun hashes only files that changed since. */
export interface Verified {
  version: 1
  files: Record<string, { size: number; mtimeMs: number; sha256: string }>
}
const verifiedName = ".zoom-verified.json"
export const readVerified = async (root: string): Promise<Verified> => {
  try {
    const file = await localFile(join(root, verifiedName))
    try {
      const value = JSON.parse(await file.readFile("utf8")) as Verified
      if (value.version === 1 && typeof value.files === "object" && value.files !== null) return value
    } finally {
      await file.close()
    }
  } catch {}
  return { version: 1, files: {} }
}
export const writeVerified = async (root: string, verified: Verified) => {
  try {
    await writeFileAtomic(join(root, verifiedName), JSON.stringify(verified))
  } catch {
    // Only a cache: losing it costs one rehash on the next run.
  }
}
const onlyKeys = (value: object, keys: string[]) => Object.keys(value).every((key) => keys.includes(key))
const nullableText = (value: unknown) => value === null || typeof value === "string"
const nullableTime = (value: unknown) =>
  value === null ||
  (typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
export const readManifest = async (path: string, signal?: AbortSignal): Promise<ArchiveManifest | null> => {
  checkCancelled(signal)
  let file: FileHandle
  try {
    file = await localFile(path)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  try {
    if ((await file.stat()).size > 1048576) throw new Error("manifest size")
    const content = await file.readFile("utf8")
    checkCancelled(signal)
    const value = JSON.parse(content) as ArchiveManifest
    if (
      value.version !== 1 ||
      !string(value.meeting?.uuid) ||
      !string(value.meeting.id) ||
      !Array.isArray(value.files) ||
      !onlyKeys(value, ["version", "meeting", "files"]) ||
      !onlyKeys(value.meeting, ["id", "uuid", "title", "startedAt"]) ||
      !nullableText(value.meeting.title) ||
      !nullableTime(value.meeting.startedAt)
    )
      throw new Error("manifest shape")
    const ids = new Set<string>()
    const files = value.files.map((entry): ArchivedFile => {
      if (
        !onlyKeys(entry, ["id", "path", "size", "sha256", "remoteSize", "type", "format", "startedAt", "endedAt"]) ||
        !string(entry.type) ||
        !nullableText(entry.format) ||
        !nullableTime(entry.startedAt) ||
        !nullableTime(entry.endedAt) ||
        !string(entry.id) ||
        ids.has(entry.id) ||
        !/^[a-f0-9]{64}-[a-f0-9]{64}\.(mp4|m4a|mp3|wav|vtt|txt|json|bin)$/.test(entry.path) ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        (entry.remoteSize !== null && (!Number.isSafeInteger(entry.remoteSize) || entry.remoteSize < 0)) ||
        entry.path !== filename(value.meeting.uuid, { id: entry.id, format: entry.format } as RecordingAsset)
      )
        throw new Error("manifest file")
      ids.add(entry.id)
      return {
        id: entry.id,
        path: entry.path,
        size: entry.size,
        sha256: entry.sha256,
        remoteSize: entry.remoteSize ?? null,
        type: string(entry.type) ?? "unknown",
        format: string(entry.format),
        startedAt: string(entry.startedAt),
        endedAt: string(entry.endedAt),
      }
    })
    if (!path.endsWith(manifestName(value.meeting.uuid))) throw new Error("manifest identity")
    return {
      version: 1,
      meeting: {
        id: value.meeting.id,
        uuid: value.meeting.uuid,
        title: string(value.meeting.title),
        startedAt: string(value.meeting.startedAt),
      },
      files,
    }
  } catch {
    checkCancelled(signal)
    throw new CliError("validation_error", "archive manifest is invalid")
  } finally {
    await file.close()
  }
}
export const writeManifest = (root: string, manifest: ArchiveManifest) =>
  writeFileAtomic(join(root, manifestName(manifest.meeting.uuid)), `${JSON.stringify(manifest, null, 2)}\n`)
export const inspectArchive = async (
  destination: string,
  options: { signal?: AbortSignal } = {},
): Promise<ArchiveManifest[]> => {
  checkCancelled(options.signal)
  try {
    const root = await realpath(destination)
    const names = (await readdir(root)).filter((name) => /^\.zoom-archive-[a-f0-9]{64}\.json$/.test(name)).sort()
    const manifests: ArchiveManifest[] = []
    for (const name of names) {
      checkCancelled(options.signal)
      const manifest = await readManifest(join(root, name), options.signal)
      if (manifest) manifests.push(manifest)
    }
    return manifests
  } catch (error) {
    checkCancelled(options.signal)
    if (isCliError(error)) throw error
    throw new CliError("configuration_error", "archive destination could not be read")
  }
}
export const verifyArchive = async (
  destination: string,
  options: { signal?: AbortSignal } = {},
): Promise<ArchiveVerification[]> => {
  checkCancelled(options.signal)
  const manifests = await inspectArchive(destination, options)
  const root = await realpath(destination)
  const result: ArchiveVerification[] = []
  for (const manifest of manifests)
    for (const file of manifest.files) {
      checkCancelled(options.signal)
      let valid = false
      try {
        const local = await fingerprint(join(root, file.path), options.signal)
        valid = local.size === file.size && local.sha256 === file.sha256
      } catch {
        checkCancelled(options.signal)
      }
      result.push({
        manifestPath: join(destination, manifestName(manifest.meeting.uuid)),
        id: file.id,
        path: file.path,
        valid,
      })
    }
  return result
}
