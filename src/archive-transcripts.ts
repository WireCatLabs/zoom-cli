import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { join } from "node:path"
import { parseVtt, type TranscriptLine } from "@wirecat/cli-core/meetings"
import { checkCancelled, ZoomError } from "./errors.js"
import { openOrdinaryFile } from "./ordinary-file.js"
import { type ArchivedFile, type ArchiveManifest, inspectArchive } from "./recording-archive.js"

export interface ArchiveTranscriptOptions {
  uuid?: string
  fileIds?: string[]
  maxBytes?: number
  signal?: AbortSignal
}
export interface ArchiveTranscript {
  meeting: ArchiveManifest["meeting"]
  asset: ArchivedFile
  cues: TranscriptLine[]
}
export interface ArchiveTranscriptSearchOptions extends ArchiveTranscriptOptions {
  limit?: number
}
export interface ArchiveTranscriptMatch extends TranscriptLine {
  meeting: ArchiveManifest["meeting"]
  asset: ArchivedFile
  /** Zero-based cue position in this asset, retaining the shared parser's file order. */
  position: number
}
export interface ArchiveTranscriptSearchReport {
  items: ArchiveTranscriptMatch[]
  page: 1
  limit: number
  hasMore: boolean
}
const validate = (destination: string, options: ArchiveTranscriptOptions): number => {
  const maxBytes = options.maxBytes === undefined ? 8 * 1024 ** 2 : options.maxBytes
  if (typeof destination !== "string" || !destination.trim() || !Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new ZoomError("validation_error", "archive destination and positive transcript byte limit are required")
  if (options.uuid !== undefined && (typeof options.uuid !== "string" || !options.uuid.trim()))
    throw new ZoomError("validation_error", "archive occurrence UUID must be nonempty")
  if (
    options.fileIds !== undefined &&
    (!Array.isArray(options.fileIds) ||
      options.fileIds.length === 0 ||
      options.fileIds.some((id) => typeof id !== "string" || !id.trim()))
  )
    throw new ZoomError("validation_error", "archive transcript selection must contain nonempty file ids")
  return maxBytes
}
const readTranscript = async (
  destination: string,
  asset: ArchivedFile,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<TranscriptLine[]> => {
  checkCancelled(signal)
  if (asset.size > maxBytes) throw new ZoomError("validation_error", "archive transcript exceeds the byte limit")
  try {
    const file = await openOrdinaryFile(join(destination, asset.path))
    try {
      checkCancelled(signal)
      const stat = await file.stat()
      if (!stat.isFile()) throw new ZoomError("validation_error", "archive transcript must be an ordinary file")
      if (stat.size > maxBytes) throw new ZoomError("validation_error", "archive transcript exceeds the byte limit")
      if (stat.size !== asset.size)
        throw new ZoomError("validation_error", "archive transcript failed size verification")
      const hash = createHash("sha256")
      const chunks: Buffer[] = []
      let size = 0
      for (;;) {
        checkCancelled(signal)
        const buffer = Buffer.alloc(Math.min(65536, maxBytes - size + 1))
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
        checkCancelled(signal)
        if (bytesRead === 0) break
        size += bytesRead
        if (size > maxBytes) throw new ZoomError("validation_error", "archive transcript exceeds the byte limit")
        const chunk = buffer.subarray(0, bytesRead)
        hash.update(chunk)
        chunks.push(chunk)
      }
      if (size !== asset.size || hash.digest("hex") !== asset.sha256)
        throw new ZoomError("validation_error", "archive transcript failed checksum verification")
      let text: string
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))
      } catch {
        throw new ZoomError("validation_error", "archive transcript is not valid UTF-8")
      }
      try {
        return parseVtt(text)
      } catch {
        throw new ZoomError("validation_error", "archive transcript is not valid WebVTT")
      }
    } finally {
      await file.close()
    }
  } catch (error) {
    checkCancelled(signal)
    if (error instanceof ZoomError) throw error
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null
    if (code === "ENOENT") throw new ZoomError("not_found", "archive transcript file was not found")
    if (code === "ELOOP") throw new ZoomError("validation_error", "archive transcript must not be a symlink")
    throw new ZoomError("configuration_error", "archive transcript could not be read")
  }
}

/** Verified, bounded VTT assets in manifest/file order; each handle closes before its result is yielded. */
export async function* readArchiveTranscripts(
  destination: string,
  options: ArchiveTranscriptOptions = {},
): AsyncGenerator<ArchiveTranscript, void, void> {
  const maxBytes = validate(destination, options)
  checkCancelled(options.signal)
  let root: string
  try {
    root = await realpath(destination)
  } catch {
    checkCancelled(options.signal)
    throw new ZoomError("configuration_error", "archive destination could not be read")
  }
  const manifests = await inspectArchive(root, { signal: options.signal })
  const selected =
    options.uuid === undefined ? manifests : manifests.filter((item) => item.meeting.uuid === options.uuid)
  if (options.uuid !== undefined && selected.length === 0)
    throw new ZoomError("not_found", "archive occurrence UUID was not found")
  const transcripts = selected.flatMap((manifest) =>
    manifest.files.filter((asset) => asset.format?.toLowerCase() === "vtt").map((asset) => ({ manifest, asset })),
  )
  if (options.fileIds?.some((id) => !transcripts.some((item) => item.asset.id === id)))
    throw new ZoomError("not_found", "selected archive VTT file id was not found")
  for (const { manifest, asset } of transcripts) {
    checkCancelled(options.signal)
    if (options.fileIds && !options.fileIds.includes(asset.id)) continue
    const cues = await readTranscript(root, asset, maxBytes, options.signal)
    checkCancelled(options.signal)
    yield { meeting: manifest.meeting, asset, cues }
  }
}

/** Literal text-only matching using NFC normalization and Unicode default lowercase on both sides. */
export const searchArchiveTranscripts = async (
  destination: string,
  query: string,
  options: ArchiveTranscriptSearchOptions = {},
): Promise<ArchiveTranscriptSearchReport> => {
  const limit = options.limit === undefined ? 100 : options.limit
  if (typeof query !== "string" || !query.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new ZoomError(
      "validation_error",
      "archive search requires nonempty text and an integer limit from 1 through 1000",
    )
  const needle = query.normalize("NFC").toLowerCase()
  const matches: ArchiveTranscriptMatch[] = []
  for await (const transcript of readArchiveTranscripts(destination, options))
    for (const [position, cue] of transcript.cues.entries()) {
      checkCancelled(options.signal)
      if (!cue.text.normalize("NFC").toLowerCase().includes(needle)) continue
      if (matches.length === limit) return { items: matches, page: 1, limit, hasMore: true }
      matches.push({ meeting: transcript.meeting, asset: transcript.asset, position, ...cue })
    }
  return { items: matches, page: 1, limit, hasMore: false }
}
