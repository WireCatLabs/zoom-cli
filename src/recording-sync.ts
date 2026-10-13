import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import {
  type RecordingCatalog,
  type RecordingSyncCheckpointStore,
  RecordingSyncError,
  recordingWindows,
  syncRecordingArchive as syncArchive,
} from "@wirecat/cli-core/meetings"
import { checkCancelled, ZoomError } from "./errors.js"
import { validateDownloadOptions } from "./recording-archive.js"
import { fileRecordingSyncCheckpointStore } from "./recording-sync-store.js"
import type { ArchiveReport, DownloadOptions, RecordingMeeting, ZoomRecordings } from "./recordings.js"
import { operationSignal } from "./remote-http.js"

export interface ArchiveSyncOptions extends Omit<DownloadOptions, "fileIds"> {
  from: string
  to: string
  checkpointPath?: string
  checkpointStore?: RecordingSyncCheckpointStore
  recheckFrom?: string
  maxPages?: number
  maxEntries?: number
  now?: () => number
}
export interface ArchiveSyncReceipt {
  window: { from: string; to: string }
  meeting: Pick<RecordingMeeting, "id" | "uuid" | "title">
  archive: ArchiveReport
  availability?: "unknown"
  checkpointRevision?: number | null
}
export async function* syncRecordingArchive(
  recordings: Pick<ZoomRecordings, "list" | "download"> & Partial<Pick<ZoomRecordings, "catalog">>,
  input: ArchiveSyncOptions,
): AsyncGenerator<ArchiveSyncReceipt, void, void> {
  const options = { ...input }
  let signal: AbortSignal | undefined
  try {
    recordingWindows(options.from, options.to)
    const maxBytes = validateDownloadOptions(options)
    const resume = options.resume === true
    if (!resume && (options.checkpointPath !== undefined || options.checkpointStore !== undefined))
      throw new ZoomError("validation_error", "archive checkpoints require resume mode")
    if (
      options.checkpointPath !== undefined &&
      (typeof options.checkpointPath !== "string" || !options.checkpointPath.trim())
    )
      throw new ZoomError("validation_error", "archive checkpoint path is required")
    const account = options.account ?? "legacy-uncheckpointed"
    signal = operationSignal(options.signal)
    checkCancelled(signal)
    const catalog: RecordingCatalog = recordings.catalog
      ? recordings.catalog(account)
      : {
          provider: "zoom",
          list: async (range) => ({
            items: (await recordings.list(range)).map(({ uuid, ...item }) => ({ ...item, externalId: uuid })),
            nextCursor: null,
          }),
        }
    const configKey = createHash("sha256")
      .update(JSON.stringify({ version: 1, destination: resolve(options.destination), maxBytes }))
      .digest("hex")
    const checkpointStore = resume
      ? (options.checkpointStore ??
        fileRecordingSyncCheckpointStore(
          options.checkpointPath ?? join(options.destination, ".zoom-archive-sync.json"),
        ))
      : undefined
    const receipts = syncArchive(catalog, {
      scope: { provider: "zoom", account },
      from: options.from,
      to: options.to,
      now: options.now ?? Date.now,
      signal,
      ...(options.recheckFrom === undefined ? {} : { recheckFrom: options.recheckFrom }),
      ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
      ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
      ...(checkpointStore === undefined
        ? {}
        : { checkpoint: { store: checkpointStore, jobId: "recording-archive", configKey } }),
      archive: async (occurrence, activeSignal) => {
        const { uuid, ...archive } = await recordings.download(occurrence.externalId, {
          destination: options.destination,
          signal: activeSignal,
          ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
          ...(resume ? { resume: true, account } : {}),
        })
        return { ...archive, externalId: uuid }
      },
    })
    for await (const receipt of receipts) {
      const { externalId, ...archive } = receipt.archive
      yield {
        window: receipt.window,
        meeting: { id: receipt.occurrence.id, uuid: receipt.occurrence.externalId, title: receipt.occurrence.title },
        archive: { ...archive, uuid: externalId },
        ...(resume ? { availability: receipt.availability, checkpointRevision: receipt.checkpointRevision } : {}),
      }
    }
  } catch (error) {
    if (error instanceof RecordingSyncError) {
      if (error.code === "cancelled") checkCancelled(signal)
      throw new ZoomError(error.code, error.message)
    }
    throw error
  }
}
