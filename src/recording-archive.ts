import { createHash, randomUUID } from "node:crypto"
import { type FileHandle, link, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { CliError, isCliError } from "@wirecat/cli-base"
import { retryableStatus, statusToCode } from "@wirecat/cli-base/http"
import { openOrdinaryFile, syncDirectory, type WriterLease } from "@wirecat/cli-core/files"
import { type RecordingTransferSource, transferRecording } from "@wirecat/cli-core/meetings"
import { checkCancelled, string } from "./errors.js"
import { RecordingPartialStore } from "./recording-partial-store.js"
import { readRecordingPromotion, writeRecordingPromotion } from "./recording-promotion-store.js"
import { acquireArchiveWriter } from "./recording-writer-lease.js"

export { type ArchiveLockInfo, inspectArchiveLocks, recoverArchiveLocks } from "./recording-writer-lease.js"

import type { RecordingAsset, RecordingMeeting } from "./recordings.js"
import { operationSignal, type ZoomRemote } from "./remote-http.js"

export interface DownloadOptions {
  destination: string
  account: string
  resume?: boolean
  fileIds?: string[]
  signal?: AbortSignal
  maxBytes?: number
}
export const validateDownloadOptions = (options: DownloadOptions): number => {
  const maxBytes = options.maxBytes === undefined ? 20 * 1024 ** 3 : options.maxBytes
  if (
    typeof options.destination !== "string" ||
    !options.destination.trim() ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  )
    throw new CliError("validation_error", "archive destination and positive download limit are required")
  if (options.resume !== undefined && typeof options.resume !== "boolean")
    throw new CliError("validation_error", "recording resume must be a boolean")
  if (
    typeof options.account !== "string" ||
    !options.account.trim() ||
    /[\0\r\n]/.test(options.account) ||
    options.account.length > 1000
  )
    throw new CliError("validation_error", "recording account scope must be a nonempty identifier")
  if (
    options.fileIds !== undefined &&
    (!Array.isArray(options.fileIds) ||
      options.fileIds.length === 0 ||
      options.fileIds.some((id) => typeof id !== "string" || !id.trim()))
  )
    throw new CliError("validation_error", "recording selection must contain nonempty file ids")
  return maxBytes
}
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
export interface ArchiveReport {
  uuid: string
  manifestPath: string
  downloaded: ArchivedFile[]
  skipped: ArchivedFile[]
  unavailable: RecordingAsset[]
}
export interface ArchiveVerification {
  manifestPath: string
  id: string
  path: string
  valid: boolean
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex")
const manifestName = (uuid: string) => `.zoom-archive-${digest(uuid)}.json`
const filename = (uuid: string, asset: RecordingAsset) =>
  `${digest(uuid)}-${digest(asset.id ?? "")}.${/^(mp4|m4a|mp3|wav|vtt|txt|json)$/i.test(asset.format ?? "") ? asset.format?.toLowerCase() : "bin"}`
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
const localFile = openOrdinaryFile
const fingerprint = async (
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
interface Verified {
  version: 1
  files: Record<string, { size: number; mtimeMs: number; sha256: string }>
}
const verifiedName = ".zoom-verified.json"
const readVerified = async (root: string): Promise<Verified> => {
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
const writeVerified = async (root: string, verified: Verified) => {
  const temp = join(root, `.zoom-verified-${randomUUID()}.tmp`)
  try {
    await open(temp, "wx", 0o600).then(async (file) => {
      try {
        await file.writeFile(JSON.stringify(verified))
      } finally {
        await file.close()
      }
    })
    await rename(temp, join(root, verifiedName))
  } catch {
    // Only a cache: losing it costs one rehash on the next run.
    await unlink(temp).catch(() => undefined)
  }
}
const onlyKeys = (value: object, keys: string[]) => Object.keys(value).every((key) => keys.includes(key))
const nullableText = (value: unknown) => value === null || typeof value === "string"
const nullableTime = (value: unknown) =>
  value === null ||
  (typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
const readManifest = async (path: string, signal?: AbortSignal): Promise<ArchiveManifest | null> => {
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
const writeManifest = async (root: string, manifest: ArchiveManifest) => {
  const temp = join(root, `.zoom-manifest-${randomUUID()}.tmp`)
  const file = await open(temp, "wx", 0o600)
  try {
    try {
      await file.writeFile(`${JSON.stringify(manifest, null, 2)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temp, join(root, manifestName(manifest.meeting.uuid)))
    await syncDirectory(root)
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}
const targetUrl = (input: string, base?: URL): URL => {
  let target: URL
  try {
    target = new URL(input, base)
  } catch {
    throw new CliError("invalid_response", "Zoom returned an unexpected recording download host")
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443") ||
    !/(^|\.)zoom\.(us|com)$/.test(target.hostname)
  )
    throw new CliError("invalid_response", "Zoom returned an unexpected recording download host")
  return target
}
class DownloadFailure extends CliError {
  constructor(readonly response: Response) {
    super(statusToCode(response.status), `Recording download failed (HTTP ${response.status})`)
  }
}
const transferSource = (
  remote: ZoomRemote,
  url: string,
  accessToken: string,
  format: string | null,
  signal: AbortSignal,
): RecordingTransferSource => ({
  open: async ({ offset, validator }) => {
    let target = targetUrl(url)
    let response: Response
    for (let redirects = 0; ; redirects++) {
      checkCancelled(signal)
      try {
        response = await remote.fetcher(target, {
          headers: {
            authorization: `Bearer ${accessToken}`,
            "accept-encoding": "identity",
            ...(offset !== undefined ? { range: `bytes=${offset}-`, "if-range": validator ?? "" } : {}),
          },
          redirect: "manual",
          signal,
        })
      } catch {
        checkCancelled(signal)
        throw new CliError("network_error", "Recording download could not be completed")
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get("location")
      await response.body?.cancel()
      if (!location || redirects >= 5)
        throw new CliError("invalid_response", "Zoom returned invalid recording redirects")
      target = targetUrl(location, target)
    }
    if (![200, 206, 416].includes(response.status)) {
      await response.body?.cancel()
      throw new DownloadFailure(response)
    }
    if (
      response.status !== 416 &&
      (!response.body ||
        /\btext\/html\b/i.test(response.headers.get("content-type") ?? "") ||
        (format?.toUpperCase() !== "JSON" &&
          /\bapplication\/json\b/i.test(response.headers.get("content-type") ?? "")) ||
        ![null, "identity"].includes(response.headers.get("content-encoding")))
    ) {
      await response.body?.cancel()
      throw new CliError("invalid_response", "Zoom returned an unexpected recording body")
    }
    const reader = response.body?.getReader()
    const abortReader = () => {
      void reader?.cancel().catch(() => undefined)
    }
    signal.addEventListener("abort", abortReader, { once: true })
    return {
      status: response.status,
      etag: response.headers.get("etag"),
      contentRange: response.headers.get("content-range"),
      contentLength: response.headers.get("content-length"),
      body: {
        async *[Symbol.asyncIterator]() {
          if (!reader) return
          for (;;) {
            checkCancelled(signal)
            let chunk: Awaited<ReturnType<typeof reader.read>>
            try {
              chunk = await reader.read()
            } catch {
              checkCancelled(signal)
              throw new CliError("network_error", "Recording download could not be completed")
            }
            checkCancelled(signal)
            if (chunk.done) return
            yield chunk.value
          }
        },
      },
      close: async () => {
        signal.removeEventListener("abort", abortReader)
        await reader?.cancel().catch(() => undefined)
        reader?.releaseLock()
      },
    }
  },
})
export const archiveRecording = async (
  remote: ZoomRemote,
  meeting: RecordingMeeting,
  urls: Map<string, string>,
  options: DownloadOptions,
): Promise<ArchiveReport> => {
  const signal = operationSignal(options.signal)
  checkCancelled(signal)
  const maxBytes = validateDownloadOptions(options)
  if (options.fileIds?.some((id) => !meeting.assets.some((asset) => asset.id === id)))
    throw new CliError("validation_error", "requested recording file was not found")
  let lock: WriterLease | undefined
  try {
    await mkdir(options.destination, { recursive: true })
    const root = await realpath(options.destination)
    lock = await acquireArchiveWriter(root, signal)
    const manifestPath = join(root, manifestName(meeting.uuid))
    const previous = await readManifest(manifestPath, signal)
    const manifest: ArchiveManifest = previous ?? {
      version: 1,
      meeting: { id: meeting.id, uuid: meeting.uuid, title: meeting.title, startedAt: meeting.startedAt },
      files: [],
    }
    const report: ArchiveReport = { uuid: meeting.uuid, manifestPath, downloaded: [], skipped: [], unavailable: [] }
    const verified = await readVerified(root)
    let verifiedChanged = false
    const remember = async (path: string, sha256: string) => {
      const stat = await lstat(join(root, path))
      verified.files[path] = { size: stat.size, mtimeMs: stat.mtimeMs, sha256 }
      verifiedChanged = true
    }
    for (const asset of meeting.assets) {
      checkCancelled(signal)
      if (options.fileIds && (asset.id === null || !options.fileIds.includes(asset.id))) continue
      if (!asset.available || asset.id === null) {
        report.unavailable.push(asset)
        continue
      }
      const path = filename(meeting.uuid, asset)
      const existing = manifest.files.find((file) => file.id === asset.id)
      if (existing) {
        const seen = verified.files[existing.path]
        const stat = await lstat(join(root, existing.path)).catch(() => undefined)
        const unchanged =
          seen !== undefined &&
          stat?.isFile() === true &&
          seen.size === stat.size &&
          seen.mtimeMs === stat.mtimeMs &&
          seen.sha256 === existing.sha256
        const local = unchanged
          ? { size: seen.size, sha256: seen.sha256 }
          : await fingerprint(join(root, existing.path), signal)
        if (
          existing.path !== path ||
          existing.remoteSize !== asset.size ||
          existing.startedAt !== asset.startedAt ||
          existing.endedAt !== asset.endedAt ||
          existing.size !== local.size ||
          existing.sha256 !== local.sha256
        )
          throw new CliError("validation_error", "existing recording has changed; choose a new archive destination")
        if (!unchanged) await remember(existing.path, existing.sha256)
        report.skipped.push(existing)
        continue
      }
      const locator = {
        provider: "zoom",
        account: options.account,
        occurrenceId: meeting.uuid,
        assetId: asset.id,
      }
      const persistent = options.resume ?? true
      const storage = new RecordingPartialStore(root, locator, signal, persistent, maxBytes)
      const promotionMeeting = {
        id: meeting.id,
        uuid: meeting.uuid,
        title: meeting.title,
        startedAt: meeting.startedAt,
      }
      const metadata = {
        id: asset.id,
        path,
        remoteSize: asset.size,
        type: asset.type,
        format: asset.format,
        startedAt: asset.startedAt,
        endedAt: asset.endedAt,
      }
      let present = false
      try {
        await lstat(join(root, path))
        present = true
      } catch (error) {
        if (!missing(error)) throw error
      }
      if (present) {
        const intent = persistent ? await readRecordingPromotion(root, locator, promotionMeeting, metadata) : null
        if (!intent || intent.file.size > maxBytes)
          throw new CliError(
            "validation_error",
            "recording path already exists without a verified manifest or scoped recovery record",
          )
        const completed = await storage.load(locator)
        if (
          !completed ||
          completed.offset !== intent.file.size ||
          completed.sha256 !== intent.file.sha256 ||
          completed.validator !== intent.validator ||
          (completed.total !== null && completed.total !== intent.file.size)
        )
          throw new CliError("validation_error", "recording recovery checkpoint does not prove this completed asset")
        const local = await fingerprint(join(root, path), signal, intent.file.size)
        if (local.size !== intent.file.size || local.sha256 !== intent.file.sha256)
          throw new CliError("validation_error", "recording recovery final checksum does not match")
        manifest.files.push(intent.file)
        await writeManifest(root, manifest)
        await unlink(storage.path)
        report.skipped.push(intent.file)
        continue
      }
      const temp = storage.path
      const tokens = await remote.tokens.tokens()
      let entry: ArchivedFile | undefined
      for (let attempt = 0; ; attempt++) {
        try {
          const transferred = await transferRecording(
            transferSource(remote, urls.get(asset.id) ?? "", tokens.accessToken, asset.format, signal),
            storage,
            { locator, maxBytes, expectedSize: asset.size, signal },
          )
          entry = { ...metadata, size: transferred.size, sha256: transferred.sha256 }
          if (asset.size !== null && entry.size !== asset.size)
            throw new CliError("invalid_response", "recording download size does not match Zoom metadata")
          checkCancelled(signal)
          if (persistent && storage.completed)
            await writeRecordingPromotion(root, locator, promotionMeeting, entry, storage.completed)
          checkCancelled(signal)
          await link(temp, join(root, path))
          break
        } catch (error) {
          if (!persistent) await unlink(temp).catch(() => undefined)
          checkCancelled(signal)
          const retryable =
            error instanceof DownloadFailure
              ? retryableStatus(error.response.status)
              : isCliError(error) && error.code === "network_error"
          if (
            attempt >= 2 ||
            !retryable ||
            !(await remote.pause(error instanceof DownloadFailure ? error.response : null, attempt, signal))
          )
            throw error
        }
      }
      if (!entry) throw new CliError("invalid_response", "recording transfer did not produce a verified receipt")
      manifest.files.push(entry)
      await writeManifest(root, manifest)
      await unlink(temp)
      await remember(entry.path, entry.sha256)
      report.downloaded.push(entry)
    }
    if (!previous) await writeManifest(root, manifest)
    if (verifiedChanged) await writeVerified(root, verified)
    return report
  } catch (error) {
    checkCancelled(signal)
    if (isCliError(error)) throw error
    throw new CliError("provider_error", "archive operation could not be completed")
  } finally {
    await lock?.release()
  }
}
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
