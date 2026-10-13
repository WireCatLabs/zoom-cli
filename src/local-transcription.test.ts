import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryMeetingStore, sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { expect, it, vi } from "vitest"
import {
  compactLocalTranscriptionReceipt,
  createLocalTranscriptionCapabilities,
  createWavTranscriptionSource,
  type LocalSpeechPort,
  validateLocalTranscriptionOptions,
} from "./local-transcription.js"

const context = { maxBytes: 2 * 1024 ** 2, maxDurationMs: 60000 }
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-local-transcription-"))
  const path = join(root, "AliceExample.wav")
  const frames = 16000 * 31
  const bytes = Buffer.alloc(44 + frames * 2)
  bytes.write("RIFF", 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write("WAVEfmt ", 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24)
  bytes.writeUInt32LE(32000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36)
  bytes.writeUInt32LE(frames * 2, 40)
  await writeFile(path, bytes)
  const descriptor = {
    engine: "sherpa-onnx" as const,
    model: "tiny-example",
    version: "a".repeat(64),
    sampleRate: 16000 as const,
    maxChunkSamples: 480000 as const,
  }
  const model = {
    ...descriptor,
    recognize: vi.fn(async (_samples: Float32Array) => "Alice Example invented words"),
    close: vi.fn(async () => {}),
  }
  const speech: LocalSpeechPort = { describe: vi.fn(() => descriptor), open: vi.fn(async () => model) }
  const load = vi.fn(async () => speech)
  const source = createWavTranscriptionSource(path, {
    model: descriptor.model,
    modelsDirectory: join(root, "invented-models"),
    speech: load,
    env: { HOME: root },
  })
  return { root, path, bytes, descriptor, model, speech, load, source }
}
const collect = async <T>(items: AsyncIterable<T>) => {
  const result = []
  for await (const item of items) result.push(item)
  return result
}
it("describes audio and pinned recognition provenance without opening a model", async () => {
  const { source, speech, model } = await fixture()
  const media = await source.describe(context)
  expect(media).toMatchObject({
    format: "wav",
    durationMs: 31000,
    recognition: { engine: "sherpa-onnx", model: "tiny-example", version: "a".repeat(64), timing: "fixed-windows" },
  })
  expect(speech.open).not.toHaveBeenCalled()
  expect(model.recognize).not.toHaveBeenCalled()
  expect(model.close).not.toHaveBeenCalled()
})
it("uses the published speech descriptor for preview and rejects absent explicitly selected models without installing them", async () => {
  const input = await fixture()
  const source = createWavTranscriptionSource(input.path, {
    model: "parakeet-v3",
    modelsDirectory: join(input.root, "empty-models"),
    env: { HOME: input.root, XDG_CACHE_HOME: join(input.root, "cache") },
  })
  const media = await source.describe(context)
  expect(media.recognition).toMatchObject({ engine: "sherpa-onnx", model: "parakeet-v3", timing: "fixed-windows" })
  expect(media.recognition.version).toMatch(/^[a-f0-9]{64}$/)
  await expect(collect(source.segments(media, context))).rejects.toMatchObject({ code: "not_found" })
})
it("reuses an installed recognizer over bounded coarse windows and closes it after full verification", async () => {
  const { source, speech, model, root } = await fixture()
  const media = await source.describe(context)
  expect(await collect(source.segments(media, context))).toEqual([
    { startMs: 0, endMs: 30000, text: "Alice Example invented words" },
    { startMs: 30000, endMs: 31000, text: "Alice Example invented words" },
  ])
  expect(model.recognize.mock.calls.map(([samples]) => samples.length)).toEqual([480000, 16000])
  expect(speech.open).toHaveBeenCalledExactlyOnceWith(
    "tiny-example",
    expect.objectContaining({ directory: join(root, "invented-models") }),
  )
  expect(model.close).toHaveBeenCalledTimes(1)
})
it("rejects descriptor substitution and corrected audio before model allocation", async () => {
  const { source, speech, path, bytes } = await fixture()
  const media = await source.describe(context)
  await expect(collect(source.segments({ ...media, contentHash: "b".repeat(64) }, context))).rejects.toThrow(
    "descriptor",
  )
  const changed = Buffer.from(bytes)
  changed.writeInt16LE(4, 44)
  await writeFile(path, changed)
  await expect(collect(source.segments(media, context))).rejects.toThrow("content changed")
  expect(speech.open).not.toHaveBeenCalled()
})
it("rejects a model-version change and closes the allocated model without inference", async () => {
  const { source, model } = await fixture()
  const media = await source.describe(context)
  model.version = "b".repeat(64)
  await expect(collect(source.segments(media, context))).rejects.toThrow("recognizer changed")
  expect(model.recognize).not.toHaveBeenCalled()
  expect(model.close).toHaveBeenCalledTimes(1)
})
it("closes the model after an inference failure or cancellation between windows", async () => {
  const failed = await fixture()
  const media = await failed.source.describe(context)
  failed.model.recognize.mockRejectedValueOnce(new Error("invented inference failure"))
  await expect(collect(failed.source.segments(media, context))).rejects.toThrow("inference failure")
  expect(failed.model.close).toHaveBeenCalledTimes(1)
  const interrupted = await fixture()
  const planned = await interrupted.source.describe(context)
  const controller = new AbortController()
  const iterator = interrupted.source
    .segments(planned, { ...context, signal: controller.signal })
    [Symbol.asyncIterator]()
  await iterator.next()
  controller.abort()
  await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" })
  expect(interrupted.model.recognize).toHaveBeenCalledTimes(1)
  expect(interrupted.model.close).toHaveBeenCalledTimes(1)
})
it("an input mutation during recognition rejects source completion and prevents subsequent durable append", async () => {
  const { source, path, bytes, model } = await fixture()
  const media = await source.describe(context)
  model.recognize.mockImplementationOnce(async () => {
    const changed = Buffer.from(bytes)
    changed.writeInt16LE(4, 44 + 16000 * 30 * 2)
    await writeFile(path, changed)
    return "Alice Example first window"
  })
  await expect(collect(source.segments(media, context))).rejects.toThrow("changed during recognition")
  expect(model.close).toHaveBeenCalledTimes(1)
})
it("selected account ownership is captured before target resolution and precedes all media/model IO", async () => {
  const speech = vi.fn(async () => {
    throw new Error("unexpected model IO")
  })
  const append = vi.fn(async () => {
    throw new Error("unexpected write")
  })
  const store = {
    accountId: 1,
    resolveMeeting: vi.fn(async () => ({ accountId: 2, meetingId: 3, externalId: "foreign-example" })),
    appendTranscriptsWithReceipt: append,
  }
  const capabilities = createLocalTranscriptionCapabilities(store, { speech })
  store.accountId = 2
  await expect(
    capabilities.transcribe("meeting:2/3", "/missing-example.wav", { model: "tiny-example" }),
  ).rejects.toMatchObject({ code: "not_found" })
  expect(speech).not.toHaveBeenCalled()
  expect(append).not.toHaveBeenCalled()
  await expect(capabilities.transcribe("meeting:2/3", "/missing-example.wav", { model: "" })).rejects.toMatchObject({
    code: "validation_error",
  })
  const controller = new AbortController()
  controller.abort()
  await expect(
    capabilities.transcribe("meeting:2/3", "/missing-example.wav", {
      model: "tiny-example",
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ code: "cancelled" })
  expect(() => createLocalTranscriptionCapabilities({ ...store, accountId: 0 })).toThrow("account")
})

it("actual published SDK previews and atomically appends independent, replayable local revisions without replacing provider text", async () => {
  const fixture = await fixtureForIntegration()
  const preview = await fixture.capabilities.transcribe("1", fixture.path, { model: "tiny-example" })
  expect(preview.applied).toBe(false)
  expect(fixture.append).not.toHaveBeenCalled()
  expect(fixture.model.recognize).not.toHaveBeenCalled()
  const first = await fixture.capabilities.transcribe("1", fixture.path, { model: "tiny-example", apply: true })
  expect(compactLocalTranscriptionReceipt(first)).toMatchObject({
    applied: true,
    meetingId: fixture.saved.meeting.id,
    insertedTranscripts: 1,
    replayedTranscripts: 0,
    segments: 2,
    timing: "fixed-windows",
  })
  const repeated = await fixture.capabilities.transcribe("1", fixture.path, { model: "tiny-example", apply: true })
  expect(repeated.append?.replayedTranscripts).toBe(1)
  const changed = Buffer.from(fixture.bytes)
  changed.writeInt16LE(6, 44)
  await writeFile(fixture.path, changed)
  const corrected = await fixture.capabilities.transcribe("1", fixture.path, { model: "tiny-example", apply: true })
  expect(corrected.append?.supersededTranscripts).toBe(1)
  const current = await fixture.store.meeting(fixture.saved.meeting.id)
  expect(current?.transcripts).toHaveLength(3)
  expect(current?.transcripts.filter((value) => value.transcript.source === "api")).toEqual(fixture.saved.transcripts)
  expect(current?.participants).toEqual(fixture.saved.participants)
  expect(current?.summaries).toEqual(fixture.saved.summaries)
  expect(
    current?.transcripts
      .flatMap((value) => (value.transcript.source.startsWith("local/") ? value.rows : []))
      .every((row) => row.speakerParticipantId === null),
  ).toBe(true)
  const output = JSON.stringify(compactLocalTranscriptionReceipt(corrected))
  expect(output).not.toMatch(/Alice Example invented words|transcripts|\/tmp\//)
})
const fixtureForIntegration = async () => {
  const input = await fixture()
  const store = memoryMeetingStore()
  const saved = await store.saveMeeting(sampleMeeting())
  const append = vi.fn(async (value: Parameters<typeof store.appendTranscripts>[0]) => {
    const before = await store.meeting(saved.meeting.id)
    const transcript = value.transcripts[0]
    if (!transcript || !before) throw new Error("missing invented fixture")
    const replayed = before.transcripts.some(
      (entry) =>
        entry.transcript.source === transcript.source && entry.transcript.contentHash === transcript.contentHash,
    )
    const superseded = replayed
      ? 0
      : before.transcripts.filter(
          (entry) => entry.transcript.source === transcript.source && entry.transcript.supersededAt === null,
        ).length
    const meeting = await store.appendTranscripts(value)
    return {
      meeting,
      created: false,
      insertedTranscripts: replayed ? 0 : 1,
      replayedTranscripts: replayed ? 1 : 0,
      supersededTranscripts: superseded,
    }
  })
  const capabilities = createLocalTranscriptionCapabilities(
    {
      accountId: 1,
      resolveMeeting: async () => ({ accountId: 1, meetingId: saved.meeting.id, externalId: saved.meeting.externalId }),
      appendTranscriptsWithReceipt: append,
    },
    { speech: input.load, now: () => 5000 },
  )
  return { ...input, store, saved, append, capabilities }
}
it("persists local revisions through the published native receipt port and survives reopening without changing provider evidence", async () => {
  const { openStore } = await import("@wirecat/cli-core/store")
  const input = await fixture()
  const path = join(input.root, "invented-meetings.db")
  const env = { HOME: input.root, MESSAGING_STORE: path }
  const store = await openStore({ path, env, now: () => 5000 })
  let expected: Awaited<ReturnType<typeof store.meetings.meeting>>
  let meetingId = 0
  try {
    const accountId = await store.saveAccount(
      { provider: "example", account: "AliceExample" },
      { name: "Alice Example" },
    )
    const seed = sampleMeeting()
    seed.meeting.accountId = accountId
    const saved = await store.meetings.saveMeeting(seed)
    meetingId = saved.meeting.id
    const capabilities = createLocalTranscriptionCapabilities(
      {
        accountId,
        resolveMeeting: async () => ({ accountId, meetingId, externalId: saved.meeting.externalId }),
        appendTranscriptsWithReceipt: (request) => store.meetings.appendTranscriptsWithReceipt(request),
      },
      { speech: input.load, now: () => 6000 },
    )
    const first = await capabilities.transcribe(String(meetingId), input.path, { model: "tiny-example", apply: true })
    expect(first.append).toMatchObject({ created: false, insertedTranscripts: 1, replayedTranscripts: 0 })
    expect(
      (await capabilities.transcribe(String(meetingId), input.path, { model: "tiny-example", apply: true })).append,
    ).toMatchObject({ insertedTranscripts: 0, replayedTranscripts: 1 })
    const changed = Buffer.from(input.bytes)
    changed.writeInt16LE(8, 44)
    await writeFile(input.path, changed)
    const corrected = await capabilities.transcribe(String(meetingId), input.path, {
      model: "tiny-example",
      apply: true,
    })
    expect(corrected.append).toMatchObject({ insertedTranscripts: 1, supersededTranscripts: 1 })
    expected = await store.meetings.meeting(meetingId)
    expect(expected?.transcripts.filter((entry) => entry.transcript.source === "api")).toEqual(saved.transcripts)
    expect(expected?.participants).toEqual(saved.participants)
    expect(expected?.transcripts.filter((entry) => entry.transcript.source.startsWith("local/"))).toHaveLength(2)
    expect(expected?.summaries).toEqual(saved.summaries)
  } finally {
    await store.close()
  }
  const reopened = await openStore({ path, env })
  try {
    expect(await reopened.meetings.meeting(meetingId)).toEqual(expected)
  } finally {
    await reopened.close()
  }
})
it("a recognition failure or changing media never reaches the append port", async () => {
  const input = await fixtureForIntegration()
  input.model.recognize.mockRejectedValueOnce(new Error("invented model failure"))
  await expect(input.capabilities.transcribe("1", input.path, { model: "tiny-example", apply: true })).rejects.toThrow(
    "model failure",
  )
  expect(input.append).not.toHaveBeenCalled()
  input.model.recognize.mockImplementationOnce(async () => {
    const changed = Buffer.from(input.bytes)
    changed.writeInt16LE(7, 44 + 16000 * 30 * 2)
    await writeFile(input.path, changed)
    return "Alice Example words"
  })
  await expect(input.capabilities.transcribe("1", input.path, { model: "tiny-example", apply: true })).rejects.toThrow(
    "changed during recognition",
  )
  expect(input.append).not.toHaveBeenCalled()
})

it("validates all native transcription budgets and model-directory bounds before resolving a target", async () => {
  for (const options of [
    { model: "" },
    { model: "x".repeat(201) },
    { model: "bad\nmodel" },
    { model: "parakeet-v3", modelsDirectory: "relative" },
    { model: "parakeet-v3", modelsDirectory: `/${"x".repeat(4096)}` },
    { model: "parakeet-v3", maxBytes: 4 * 1024 ** 3 + 1 },
    { model: "parakeet-v3", maxDurationMs: 0 },
    { model: "parakeet-v3", maxSegments: 1.5 },
    { model: "parakeet-v3", maxTextBytes: 64 * 1024 ** 2 + 1 },
    { model: "parakeet-v3", apply: "yes" as unknown as boolean },
  ])
    expect(() => validateLocalTranscriptionOptions(options)).toThrow()
  expect(
    validateLocalTranscriptionOptions({
      model: "parakeet-v3",
      modelsDirectory: process.execPath,
      maxBytes: 100,
      maxDurationMs: 100,
      maxSegments: 10,
      maxTextBytes: 100,
      apply: true,
      dryRun: true,
    }),
  ).toMatchObject({ model: "parakeet-v3", apply: true, dryRun: true })
})
it("compact receipts reject missing commitments and retain compatibility with optional provenance fields", async () => {
  const fixture = await fixtureForIntegration()
  const preview = await fixture.capabilities.transcribe("1", fixture.path, { model: "tiny-example" })
  expect(() => compactLocalTranscriptionReceipt(preview)).toThrow("acknowledgement")
  expect(() => compactLocalTranscriptionReceipt({ ...preview, applied: true })).toThrow("acknowledgement")
  const first = await fixture.capabilities.transcribe("1", fixture.path, { model: "tiny-example", apply: true })
  const legacy = { ...first, media: { ...first.media, recognition: { engine: "sherpa-onnx", model: "tiny-example" } } }
  expect(compactLocalTranscriptionReceipt(legacy)).toMatchObject({ modelVersion: null, timing: "recognition-segments" })
})
