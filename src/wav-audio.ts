import { createHash } from "node:crypto"
import type { FileHandle } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { checkCancelled, ZoomError } from "./errors.js"
import { openOrdinaryFile } from "./ordinary-file.js"

export interface WavAudioDescriptor {
  id: string
  contentHash: string
  size: number
  durationMs: number
  format: "wav"
  sampleRate: 16000 | 48000
  channels: 1 | 2
}
export interface WavAudioOptions {
  maxBytes: number
  maxDurationMs: number
  signal?: AbortSignal
}
export interface WavAudioPlan {
  readonly media: Readonly<WavAudioDescriptor>
}
export interface WavPcmWindow {
  startMs: number
  endMs: number
  samples: Float32Array
}
interface Layout {
  sampleRate: 16000 | 48000
  channels: 1 | 2
  dataOffset: number
  dataSize: number
  frames: number
}
interface Prepared {
  path: string
  dev: bigint
  ino: bigint
  layout: Layout
}
const prepared = new WeakMap<WavAudioPlan, Prepared>()
const invalid = (): never => {
  throw new ZoomError(
    "validation_error",
    "local transcription requires PCM16 mono/stereo WAV at 16 or 48 kHz; convert the media locally to PCM WAV first",
  )
}
const validate = (options: WavAudioOptions) => {
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    options.maxBytes > 4 * 1024 ** 3 ||
    !Number.isSafeInteger(options.maxDurationMs) ||
    options.maxDurationMs < 1 ||
    options.maxDurationMs > 24 * 3600_000
  )
    throw new ZoomError("validation_error", "audio byte and duration budgets must be positive bounded integers")
  checkCancelled(options.signal)
}
const exact = async (file: FileHandle, offset: number, size: number, signal?: AbortSignal): Promise<Buffer> => {
  const bytes = Buffer.alloc(size)
  let read = 0
  while (read < size) {
    checkCancelled(signal)
    const result = await file.read(bytes, read, size - read, offset + read)
    if (!result.bytesRead) throw new ZoomError("validation_error", "WAV changed or was truncated while reading")
    read += result.bytesRead
  }
  return bytes
}
const layoutOf = async (file: FileHandle, size: number, options: WavAudioOptions): Promise<Layout> => {
  if (size < 44 || size > options.maxBytes) invalid()
  const header = await exact(file, 0, 12, options.signal)
  if (
    header.toString("ascii", 0, 4) !== "RIFF" ||
    header.toString("ascii", 8, 12) !== "WAVE" ||
    header.readUInt32LE(4) + 8 !== size
  )
    invalid()
  let format: { sampleRate: 16000 | 48000; channels: 1 | 2 } | undefined
  let data: { offset: number; size: number } | undefined
  let at = 12
  let chunks = 0
  while (at < size) {
    checkCancelled(options.signal)
    if (++chunks > 1024 || size - at < 8) invalid()
    const chunk = await exact(file, at, 8, options.signal)
    const kind = chunk.toString("ascii", 0, 4)
    const length = chunk.readUInt32LE(4)
    const start = at + 8
    const next = start + length + (length % 2)
    if (next > size) invalid()
    if (kind === "fmt ") {
      if (format || ![16, 18].includes(length)) invalid()
      const bytes = await exact(file, start, length, options.signal)
      const channels = bytes.readUInt16LE(2)
      const sampleRate = bytes.readUInt32LE(4)
      if (
        bytes.readUInt16LE(0) !== 1 ||
        ![1, 2].includes(channels) ||
        ![16000, 48000].includes(sampleRate) ||
        bytes.readUInt16LE(14) !== 16 ||
        bytes.readUInt16LE(12) !== channels * 2 ||
        bytes.readUInt32LE(8) !== sampleRate * channels * 2 ||
        (length === 18 && bytes.readUInt16LE(16) !== 0)
      )
        invalid()
      format = { sampleRate: sampleRate as 16000 | 48000, channels: channels as 1 | 2 }
    } else if (kind === "data") {
      if (data || !length) invalid()
      data = { offset: start, size: length }
    }
    at = next
  }
  if (!format || !data || data.size % (format.channels * 2) !== 0) return invalid()
  const frames = data.size / (format.channels * 2)
  if (Math.ceil((frames * 1000) / format.sampleRate) > options.maxDurationMs)
    throw new ZoomError("validation_error", "WAV exceeds the configured duration limit")
  return { ...format, dataOffset: data.offset, dataSize: data.size, frames }
}
const hashRange = async (
  file: FileHandle,
  hash: ReturnType<typeof createHash>,
  start: number,
  end: number,
  signal?: AbortSignal,
) => {
  let at = start
  while (at < end) {
    const bytes = await exact(file, at, Math.min(65536, end - at), signal)
    hash.update(bytes)
    at += bytes.length
  }
}
const hashFile = async (file: FileHandle, size: number, signal?: AbortSignal) => {
  const hash = createHash("sha256")
  await hashRange(file, hash, 0, size, signal)
  if ((await file.stat()).size !== size)
    throw new ZoomError("validation_error", "WAV changed while verifying its content")
  return hash.digest("hex")
}
export const preflightWavAudio = async (path: string, input: WavAudioOptions): Promise<WavAudioPlan> => {
  const options = { ...input }
  validate(options)
  if (typeof path !== "string" || !path.trim() || /\0/.test(path))
    throw new ZoomError("validation_error", "local audio file is required")
  const absolute = resolve(path)
  const file = await openOrdinaryFile(absolute)
  try {
    const stat = await file.stat({ bigint: true })
    const size = Number(stat.size)
    const layout = await layoutOf(file, size, options)
    const contentHash = await hashFile(file, size, options.signal)
    const after = await file.stat({ bigint: true })
    if (stat.size !== after.size || stat.mtimeNs !== after.mtimeNs)
      throw new ZoomError("validation_error", "WAV changed while preparing the transcription")
    const media = Object.freeze({
      id: createHash("sha256").update(basename(absolute)).digest("hex"),
      contentHash,
      size,
      durationMs: Math.ceil((layout.frames * 1000) / layout.sampleRate),
      format: "wav" as const,
      sampleRate: layout.sampleRate,
      channels: layout.channels,
    })
    const plan = Object.freeze({ media })
    prepared.set(plan, { path: absolute, dev: stat.dev, ino: stat.ino, layout })
    return plan
  } finally {
    await file.close()
  }
}
export const openWavAudio = async (
  plan: WavAudioPlan,
  input: WavAudioOptions,
): Promise<{ windows(): AsyncIterable<WavPcmWindow>; close(): Promise<void> }> => {
  const options = { ...input }
  validate(options)
  const known = prepared.get(plan)
  if (!known) throw new ZoomError("validation_error", "audio plan was not prepared by this adapter")
  const file = await openOrdinaryFile(known.path)
  try {
    const stat = await file.stat({ bigint: true })
    if (stat.dev !== known.dev || stat.ino !== known.ino || Number(stat.size) !== plan.media.size)
      throw new ZoomError("validation_error", "WAV identity changed before transcription")
    const layout = await layoutOf(file, plan.media.size, options)
    if (
      JSON.stringify(layout) !== JSON.stringify(known.layout) ||
      (await hashFile(file, plan.media.size, options.signal)) !== plan.media.contentHash
    )
      throw new ZoomError("validation_error", "WAV content changed before transcription")
    let closed = false
    let consumed = false
    return {
      async *windows() {
        if (closed || consumed)
          throw new ZoomError("configuration_error", "audio source can be consumed once before closing")
        consumed = true
        const hash = createHash("sha256")
        await hashRange(file, hash, 0, layout.dataOffset, options.signal)
        const step = layout.sampleRate / 16000
        for (let frame = 0; frame < layout.frames; ) {
          checkCancelled(options.signal)
          const count = Math.min(layout.sampleRate * 30, layout.frames - frame)
          const bytes = await exact(
            file,
            layout.dataOffset + frame * layout.channels * 2,
            count * layout.channels * 2,
            options.signal,
          )
          hash.update(bytes)
          const samples = new Float32Array(Math.floor(count / step))
          for (let index = 0; index < samples.length; index++) {
            let sum = 0
            for (let offset = 0; offset < step; offset++)
              for (let channel = 0; channel < layout.channels; channel++)
                sum += bytes.readInt16LE(((index * step + offset) * layout.channels + channel) * 2)
            samples[index] = sum / (32768 * step * layout.channels)
          }
          const startMs = Math.floor((frame * 1000) / layout.sampleRate)
          frame += count
          if (samples.length) yield { startMs, endMs: Math.ceil((frame * 1000) / layout.sampleRate), samples }
        }
        await hashRange(file, hash, layout.dataOffset + layout.dataSize, plan.media.size, options.signal)
        if (hash.digest("hex") !== plan.media.contentHash || (await file.stat()).size !== plan.media.size)
          throw new ZoomError("validation_error", "WAV changed during recognition; no transcript may be stored")
      },
      async close() {
        if (!closed) {
          closed = true
          await file.close()
        }
      },
    }
  } catch (error) {
    await file.close()
    throw error
  }
}
