import { createHash } from "node:crypto"
import { mkdtemp, rename, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { openWavAudio, preflightWavAudio } from "./wav-audio.js"

const budget = { maxBytes: 16 * 1024 ** 2, maxDurationMs: 120000 }
const wav = (frames = 16000, rate = 16000, channels = 1) => {
  const bytes = Buffer.alloc(44 + frames * channels * 2)
  bytes.write("RIFF", 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write("WAVEfmt ", 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * channels * 2, 28)
  bytes.writeUInt16LE(channels * 2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < channels; channel++)
      bytes.writeInt16LE(channel === 0 ? 8192 : -4096, 44 + (frame * channels + channel) * 2)
  return bytes
}
const fixture = async (bytes = wav()) => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-wave-audio-"))
  const path = join(root, "AliceExample.wav")
  await writeFile(path, bytes)
  return { root, path, bytes }
}
const collect = async <T>(items: AsyncIterable<T>) => {
  const values = []
  for await (const value of items) values.push(value)
  return values
}
it("describes invented PCM WAV without a model and streams bounded 16 kHz windows", async () => {
  const { path, bytes } = await fixture(wav(16000 * 31))
  const plan = await preflightWavAudio(path, budget)
  expect(plan.media).toMatchObject({
    durationMs: 31000,
    format: "wav",
    channels: 1,
    sampleRate: 16000,
    size: bytes.length,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  })
  expect(JSON.stringify(plan)).not.toContain(path)
  const audio = await openWavAudio(plan, budget)
  try {
    const windows = await collect(audio.windows())
    expect(windows.map((window) => [window.startMs, window.endMs, window.samples.length])).toEqual([
      [0, 30000, 480000],
      [30000, 31000, 16000],
    ])
    expect(windows[0]?.samples[0]).toBe(0.25)
    await expect(collect(audio.windows())).rejects.toThrow("once")
  } finally {
    await Promise.all([audio.close(), audio.close()])
  }
})
it("mixes stereo PCM and resamples 48 kHz without loading the whole recording", async () => {
  const { path } = await fixture(wav(48000, 48000, 2))
  const plan = await preflightWavAudio(path, budget)
  const audio = await openWavAudio(plan, budget)
  try {
    const windows = await collect(audio.windows())
    expect(windows[0]?.samples.length).toBe(16000)
    expect(windows[0]?.samples[0]).toBe(0.0625)
  } finally {
    await audio.close()
  }
})
it.each([
  "signature",
  "length",
  "codec",
  "bits",
  "channels",
  "rate",
  "byte-rate",
  "alignment",
  "empty",
  "frame-alignment",
  "duplicate-data",
  "truncated-chunk",
])("rejects malformed or unsupported WAV %s before recognition", async (kind) => {
  let bytes = wav()
  if (kind === "signature") bytes.write("OggS", 0)
  if (kind === "length") bytes.writeUInt32LE(99, 4)
  if (kind === "codec") bytes.writeUInt16LE(3, 20)
  if (kind === "bits") bytes.writeUInt16LE(24, 34)
  if (kind === "channels") bytes.writeUInt16LE(3, 22)
  if (kind === "rate") bytes.writeUInt32LE(44100, 24)
  if (kind === "byte-rate") bytes.writeUInt32LE(1, 28)
  if (kind === "alignment") bytes.writeUInt16LE(9, 32)
  if (kind === "empty") {
    bytes = wav(0)
  }
  if (kind === "frame-alignment") {
    bytes = Buffer.concat([bytes, Buffer.from([0])])
    bytes.writeUInt32LE(bytes.length - 8, 4)
    bytes.writeUInt32LE(bytes.length - 44, 40)
  }
  if (kind === "duplicate-data") {
    const extra = Buffer.from("data\x02\0\0\0\0\0", "binary")
    bytes = Buffer.concat([bytes, extra])
    bytes.writeUInt32LE(bytes.length - 8, 4)
  }
  if (kind === "truncated-chunk") {
    bytes.writeUInt32LE(bytes.length + 10, 40)
  }
  const { path } = await fixture(bytes)
  await expect(preflightWavAudio(path, budget)).rejects.toMatchObject({ code: "validation_error" })
})
it("enforces byte and duration budgets and cancellation before file opening", async () => {
  const { path } = await fixture()
  await expect(preflightWavAudio(path, { ...budget, maxBytes: 10 })).rejects.toMatchObject({ code: "validation_error" })
  await expect(preflightWavAudio(path, { ...budget, maxDurationMs: 999 })).rejects.toThrow("duration limit")
  await expect(preflightWavAudio(path, { ...budget, maxBytes: 0 })).rejects.toMatchObject({ code: "validation_error" })
  const controller = new AbortController()
  controller.abort()
  await expect(
    preflightWavAudio(join(path, "missing"), { ...budget, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "cancelled" })
})
it("rejects a forged plan, same-size content correction and replacement inode before decoding", async () => {
  const { path, bytes } = await fixture()
  const plan = await preflightWavAudio(path, budget)
  await expect(openWavAudio({ media: plan.media }, budget)).rejects.toThrow("not prepared")
  const changed = Buffer.from(bytes)
  changed.writeInt16LE(1, 44)
  await writeFile(path, changed)
  await expect(openWavAudio(plan, budget)).rejects.toThrow("content changed")
  await rename(path, `${path}.retained-original`)
  await writeFile(path, bytes)
  await expect(openWavAudio(plan, budget)).rejects.toThrow("identity changed")
})
it("hashes the actual bytes consumed during recognition and rejects an in-place correction after reopening", async () => {
  const { path, bytes } = await fixture(wav(16000 * 31))
  const plan = await preflightWavAudio(path, budget)
  const audio = await openWavAudio(plan, budget)
  const iterator = audio.windows()[Symbol.asyncIterator]()
  try {
    expect((await iterator.next()).value?.endMs).toBe(30000)
    const changed = Buffer.from(bytes)
    changed.writeInt16LE(1, 44 + 16000 * 30 * 2)
    await writeFile(path, changed)
    expect((await iterator.next()).value?.startMs).toBe(30000)
    await expect(iterator.next()).rejects.toThrow("changed during recognition")
  } finally {
    await audio.close()
  }
})
it("rejects symlink input and honors cancellation between media windows", async () => {
  const { root, path } = await fixture(wav(16000 * 31))
  if (process.platform !== "win32") {
    await symlink(path, join(root, "linked.wav"))
    await expect(preflightWavAudio(join(root, "linked.wav"), budget)).rejects.toThrow("symlink")
  }
  const controller = new AbortController()
  const plan = await preflightWavAudio(path, budget)
  const audio = await openWavAudio(plan, { ...budget, signal: controller.signal })
  const iterator = audio.windows()[Symbol.asyncIterator]()
  try {
    await iterator.next()
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" })
  } finally {
    await audio.close()
  }
  await expect(collect(audio.windows())).rejects.toThrow("closing")
})

const chunked = (chunks: { name: string; bytes: Buffer }[]) => {
  const encoded = chunks.map((chunk) => {
    const header = Buffer.alloc(8)
    header.write(chunk.name, 0, "ascii")
    header.writeUInt32LE(chunk.bytes.length, 4)
    return Buffer.concat([header, chunk.bytes, ...(chunk.bytes.length % 2 ? [Buffer.alloc(1)] : [])])
  })
  const header = Buffer.alloc(12)
  header.write("RIFF", 0)
  header.write("WAVE", 8)
  const result = Buffer.concat([header, ...encoded])
  result.writeUInt32LE(result.length - 8, 4)
  return result
}
it("accepts bounded auxiliary chunks and the PCM format extension while verifying all raw bytes", async () => {
  const base = wav()
  const bytes = chunked([
    { name: "fmt ", bytes: Buffer.concat([base.subarray(20, 36), Buffer.alloc(2)]) },
    { name: "JUNK", bytes: Buffer.from([1]) },
    { name: "data", bytes: base.subarray(44) },
    { name: "JUNK", bytes: Buffer.from("invented metadata") },
  ])
  const { path } = await fixture(bytes)
  const plan = await preflightWavAudio(path, budget)
  const audio = await openWavAudio(plan, budget)
  try {
    expect(await collect(audio.windows())).toHaveLength(1)
  } finally {
    await audio.close()
  }
})
it.each([
  "duplicate-format",
  "bad-format-size",
  "extended-format",
  "missing-format",
  "missing-data",
  "odd-frames",
  "excessive-chunks",
  "short-trailer",
])("bounds RIFF metadata structures: %s", async (kind) => {
  const base = wav()
  const format = { name: "fmt ", bytes: base.subarray(20, 36) }
  const data = { name: "data", bytes: base.subarray(44) }
  let chunks = [format, data]
  if (kind === "duplicate-format") chunks = [format, format, data]
  if (kind === "bad-format-size") chunks = [{ ...format, bytes: Buffer.alloc(15) }, data]
  if (kind === "extended-format")
    chunks = [{ ...format, bytes: Buffer.concat([format.bytes, Buffer.from([1, 0])]) }, data]
  if (kind === "missing-format") chunks = [{ name: "JUNK", bytes: Buffer.alloc(16) }, data]
  if (kind === "missing-data") chunks = [format, { name: "JUNK", bytes: Buffer.alloc(8) }]
  if (kind === "odd-frames") chunks = [format, { name: "data", bytes: Buffer.from([0]) }]
  if (kind === "excessive-chunks")
    chunks = [format, ...Array.from({ length: 1025 }, () => ({ name: "JUNK", bytes: Buffer.alloc(0) })), data]
  let bytes = chunked(chunks)
  if (kind === "short-trailer") {
    bytes = Buffer.concat([bytes, Buffer.from([0])])
    bytes.writeUInt32LE(bytes.length - 8, 4)
  }
  const { path } = await fixture(bytes)
  await expect(preflightWavAudio(path, budget)).rejects.toMatchObject({ code: "validation_error" })
})
it("rejects empty/NUL paths and invalid duration limits before filesystem access", async () => {
  await expect(preflightWavAudio("", budget)).rejects.toMatchObject({ code: "validation_error" })
  await expect(preflightWavAudio("bad\0path", budget)).rejects.toMatchObject({ code: "validation_error" })
  await expect(preflightWavAudio("missing-example.wav", { ...budget, maxDurationMs: 0 })).rejects.toMatchObject({
    code: "validation_error",
  })
})
