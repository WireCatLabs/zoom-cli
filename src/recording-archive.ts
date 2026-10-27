import { lstat, mkdir, realpath, unlink } from "node:fs/promises"
import { join } from "node:path"
import { CliError, isCliError } from "@wirecat/cli-base"
import { retryableStatus, statusToCode } from "@wirecat/cli-base/http"
import { withAttempt } from "@wirecat/cli-core/cli"
import type { WriterLease } from "@wirecat/cli-core/files"
import { type RecordingTransferSource, transferRecording } from "@wirecat/cli-core/meetings"
import { checkCancelled } from "./errors.js"
import {
  type ArchivedFile,
  type ArchiveManifest,
  filename,
  fingerprint,
  manifestName,
  readManifest,
  readVerified,
  writeManifest,
  writeVerified,
} from "./recording-manifest.js"
import { RecordingPartialStore } from "./recording-partial-store.js"
import { recordingPromotion, recordingPublication } from "./recording-promotion-store.js"
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
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
export interface ArchiveReport {
  uuid: string
  manifestPath: string
  downloaded: ArchivedFile[]
  skipped: ArchivedFile[]
  unavailable: RecordingAsset[]
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
    const response = await remote.download(url, {
      accessToken,
      signal,
      what: "recording",
      headers: {
        "accept-encoding": "identity",
        ...(offset !== undefined ? { range: `bytes=${offset}-`, "if-range": validator ?? "" } : {}),
      },
      unreachable: () => {
        checkCancelled(signal)
        return new CliError("network_error", "Recording download could not be completed")
      },
    })
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
      const publication = recordingPublication(root, locator, promotionMeeting, metadata, maxBytes, signal)
      let present = false
      try {
        await lstat(join(root, path))
        present = true
      } catch (error) {
        if (!missing(error)) throw error
      }
      if (present) {
        if (!persistent)
          throw new CliError(
            "validation_error",
            "recording path already exists without a verified manifest or scoped recovery record",
          )
        const intent = await publication.recover(
          storage.path,
          () => storage.load(locator),
          async (value) => {
            manifest.files.push(value.file)
            await writeManifest(root, manifest)
          },
        )
        report.skipped.push(intent.file)
        continue
      }
      const temp = storage.path
      const tokens = await remote.tokens.tokens()
      let entry: ArchivedFile | undefined
      let waitMs: number | undefined
      const { id, format } = asset
      for (let attempt = 0; ; attempt++) {
        try {
          const transferred = await withAttempt(
            { attempt: attempt + 1, ...(waitMs === undefined ? {} : { waitMs }) },
            () =>
              transferRecording(
                transferSource(remote, urls.get(id) ?? "", tokens.accessToken, format, signal),
                storage,
                { locator, maxBytes, expectedSize: asset.size, signal },
              ),
          )
          entry = { ...metadata, size: transferred.size, sha256: transferred.sha256 }
          if (asset.size !== null && entry.size !== asset.size)
            throw new CliError("invalid_response", "recording download size does not match Zoom metadata")
          checkCancelled(signal)
          if (persistent && storage.completed)
            await publication.write(recordingPromotion(locator, promotionMeeting, entry, storage.completed))
          checkCancelled(signal)
          await publication.publish(temp, entry, async () => {
            if (!entry) throw new CliError("invalid_response", "recording transfer did not produce a verified receipt")
            manifest.files.push(entry)
            await writeManifest(root, manifest)
          })
          break
        } catch (error) {
          if (!persistent) await unlink(temp).catch(() => undefined)
          checkCancelled(signal)
          const retryable =
            error instanceof DownloadFailure
              ? retryableStatus(error.response.status)
              : isCliError(error) && error.code === "network_error"
          if (attempt >= 2 || !retryable) throw error
          const paused = performance.now()
          if (!(await remote.pause(error instanceof DownloadFailure ? error.response : null, attempt, signal)))
            throw error
          waitMs = Math.round(performance.now() - paused)
        }
      }
      if (!entry) throw new CliError("invalid_response", "recording transfer did not produce a verified receipt")
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
