import { createHash } from "node:crypto"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Writable } from "node:stream"
import { memoryKeyring } from "@wirecat/cli-core"
import { memoryMeetingStore, sampleMeeting } from "@wirecat/cli-meetings/testing"
import { expect, it, vi } from "vitest"
import { applyArchiveImport, preflightArchiveImport } from "./archive-import.js"
import { setConfig } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import { writeStream } from "./streaming.js"
import { TokenManager } from "./tokens.js"

const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const archiveFixture = async (
  options: {
    root?: string
    uuid?: string
    startedAt?: string | null
    assets?: number
    text?: string
    timing?: string
  } = {},
) => {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "zm-test-archive-import-")))
  const uuid = options.uuid ?? "example-occurrence"
  const files = []
  const paths = []
  for (let index = 0; index < (options.assets ?? 1); index++) {
    const id = `example-asset-${index}`
    const path = `${hash(uuid)}-${hash(id)}.vtt`
    const content = `WEBVTT\n\n${options.timing ?? "00:00.000 --> 00:01.000"}\nAlice Example: ${options.text ?? "Original example plan"}\n`
    await writeFile(join(root, path), content)
    paths.push(join(root, path))
    files.push({
      id,
      path,
      size: Buffer.byteLength(content),
      sha256: hash(content),
      remoteSize: null,
      type: "audio_transcript",
      format: "vtt",
      startedAt: null,
      endedAt: null,
    })
  }
  await writeFile(
    join(root, `.zoom-archive-${hash(uuid)}.json`),
    JSON.stringify({
      version: 1,
      meeting: {
        id: "123456",
        uuid,
        title: "Example archive",
        startedAt: options.startedAt === undefined ? "2026-10-10T15:30:00.000Z" : options.startedAt,
      },
      files,
    }),
  )
  return { root, uuid, paths }
}
const collect = async <T>(values: AsyncIterable<T>): Promise<T[]> => {
  const rows: T[] = []
  for await (const row of values) rows.push(row)
  return rows
}
const cli = async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-archive-cli-"))
  const output: string[] = []
  const errors: string[] = []
  const deps: ProgramDeps = {
    configPath: join(root, "config.json"),
    tokens: new TokenManager({
      clientId: "example",
      keyring: memoryKeyring(),
      service: "example",
      fetch: async () => {
        throw new Error("unexpected token request")
      },
    }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
  }
  return { deps, output, errors }
}

it("appends a verified per-occurrence batch and preserves owner metadata, other parts and cursor", async () => {
  const { root, uuid } = await archiveFixture({ assets: 2 })
  const store = memoryMeetingStore()
  const original = await store.saveMeeting(sampleMeeting())
  await store.setCursor(1, "example-owner-cursor", 4000)
  const append = vi.spyOn(store, "appendTranscripts")
  const plan = await preflightArchiveImport(root)
  expect(plan.verifiedAssets).toBe(2)
  const receipts = await collect(applyArchiveImport(plan, store, { accountId: 1, now: 5000 }))
  expect(receipts).toEqual([
    { uuid, assetIds: ["example-asset-0", "example-asset-1"], status: "acknowledged", meetingId: original.meeting.id },
  ])
  expect(append).toHaveBeenCalledOnce()
  const after = await store.meeting(original.meeting.id)
  expect(after?.meeting).toEqual(original.meeting)
  for (const key of ["series", "participants", "chat", "summaries", "attachments"] as const)
    expect(after?.[key]).toEqual(original[key])
  expect(after?.transcripts).toHaveLength(3)
  expect(after?.transcripts[1]?.rows[0]?.speakerParticipantId).toBeNull()
  expect(after?.transcripts[1]?.transcript.metadata).toMatchObject({
    occurrenceUuid: uuid,
    recordingFileId: "example-asset-0",
  })
  expect(await store.cursor(1)).toBe("example-owner-cursor")
  expect(await collect(applyArchiveImport(plan, store, { accountId: 1, now: 6000 }))).toEqual(receipts)
  expect(await store.meeting(original.meeting.id)).toEqual(after)
})

it("uses real starts for creation and reports missing or deleted targets without fabricated counts", async () => {
  const available = await archiveFixture()
  const store = memoryMeetingStore()
  const receipts = await collect(
    applyArchiveImport(await preflightArchiveImport(available.root), store, { accountId: 1, now: 5000 }),
  )
  const saved = await store.meeting(receipts[0]?.meetingId ?? 0)
  expect(saved?.meeting.startedAt).toBe(Date.parse("2026-10-10T15:30:00.000Z"))
  expect(saved?.participants).toEqual([])
  const missing = await archiveFixture({ uuid: "example-missing", startedAt: null })
  expect(
    await collect(applyArchiveImport(await preflightArchiveImport(missing.root), store, { accountId: 1 })),
  ).toMatchObject([{ status: "unavailable", reason: "missing_or_deleted" }])
  expect(await store.meetings()).toHaveLength(1)
  const removed = sampleMeeting()
  removed.meeting.deletedAt = 5000
  await store.saveMeeting(removed)
  expect(
    await collect(applyArchiveImport(await preflightArchiveImport(available.root), store, { accountId: 1 })),
  ).toMatchObject([{ status: "unavailable" }])
  expect((await store.meeting(saved?.meeting.id ?? 0))?.meeting.deletedAt).toBe(5000)
})

it("permits startless append to an existing target and never reactivates a historical hash", async () => {
  const store = memoryMeetingStore()
  const initial = await store.saveMeeting(sampleMeeting())
  const first = await archiveFixture({ startedAt: null })
  const old = await preflightArchiveImport(first.root)
  await collect(applyArchiveImport(old, store, { accountId: 1, now: 5000 }))
  await archiveFixture({ root: first.root, startedAt: null, text: "Corrected example plan" })
  await collect(applyArchiveImport(await preflightArchiveImport(first.root), store, { accountId: 1, now: 6000 }))
  await collect(applyArchiveImport(old, store, { accountId: 1, now: 7000 }))
  expect((await store.meeting(initial.meeting.id))?.transcripts).toHaveLength(3)
  expect(await store.search("Original")).toEqual([])
  expect(await store.search("Corrected")).toHaveLength(1)
})

it("rejects corrupted later assets and aggregate oversize before producing a writable plan", async () => {
  const fixture = await archiveFixture({ assets: 2 })
  await expect(preflightArchiveImport(fixture.root, { maxTotalBytes: 1 })).rejects.toThrow(/aggregate/)
  await expect(preflightArchiveImport(fixture.root, { maxTotalBytes: 0 })).rejects.toThrow(/positive/)
  await writeFile(fixture.paths[1] ?? "", "Example corruption")
  await expect(preflightArchiveImport(fixture.root)).rejects.toThrow(/verification/)
  const invalidTimes = await archiveFixture({ timing: "00:02.000 --> 00:01.000" })
  await expect(preflightArchiveImport(invalidTimes.root)).rejects.toThrow(/cue times/)
})

it("preserves an acknowledged receipt on late cancellation and starts no next append", async () => {
  const first = await archiveFixture()
  await archiveFixture({ root: first.root, uuid: "example-second" })
  const controller = new AbortController()
  const store = memoryMeetingStore()
  const append = vi.fn(async (input: Parameters<typeof store.appendTranscripts>[0]) => {
    const result = await store.appendTranscripts(input)
    controller.abort()
    return result
  })
  const run = applyArchiveImport(
    await preflightArchiveImport(first.root),
    { appendTranscripts: append },
    { accountId: 1, signal: controller.signal },
  )
  expect((await run.next()).value).toMatchObject({ status: "acknowledged" })
  await expect(run.next()).rejects.toMatchObject({ code: "cancelled" })
  expect(append).toHaveBeenCalledOnce()
})

it("validates opaque plans, capabilities and account bounds and sanitizes append failures", async () => {
  const { root } = await archiveFixture()
  const store = memoryMeetingStore()
  await expect(
    collect(applyArchiveImport({ verifiedAssets: 0, occurrences: 0, totalBytes: 0 }, store, { accountId: 1 })),
  ).rejects.toMatchObject({ code: "validation_error" })
  const plan = await preflightArchiveImport(root)
  await expect(collect(applyArchiveImport(plan, store, { accountId: 0 }))).rejects.toMatchObject({
    code: "validation_error",
  })
  await expect(collect(applyArchiveImport(plan, {} as typeof store, { accountId: 1 }))).rejects.toMatchObject({
    code: "configuration_error",
  })
  await expect(
    collect(
      applyArchiveImport(
        plan,
        {
          appendTranscripts: async () => {
            throw new Error("example private database path")
          },
        },
        { accountId: 1 },
      ),
    ),
  ).rejects.toThrow("archive transcript append failed; earlier occurrences may be committed")
})

it("CLI preflights later corruption and aggregate bounds before opening or registering an account", async () => {
  const { root, paths } = await archiveFixture({ assets: 2 })
  const { deps, output } = await cli()
  setConfig(deps.configPath, "account.profile", "example")
  const store = memoryMeetingStore()
  const connect = vi.fn(async () => ({
    store,
    accountId: 1,
    appendTranscripts: store.appendTranscripts,
    close: async () => {},
  }))
  deps.connectStore = connect
  expect(await run(["recordings", "archive", "import", root, "--max-total-bytes", "1", "--json"], deps)).toBe(2)
  await writeFile(paths[1] ?? "", "Example corrupted later asset")
  expect(await run(["recordings", "archive", "import", root, "--json"], deps)).toBe(2)
  expect(connect).not.toHaveBeenCalled()
  expect(output).toEqual([])
})

it("CLI closes finite imports before output and streams acknowledged receipts with backpressure", async () => {
  const { root } = await archiveFixture()
  const { deps, output } = await cli()
  setConfig(deps.configPath, "account.profile", "example")
  const store = memoryMeetingStore()
  const order: string[] = []
  deps.connectStore = vi.fn(async (request) => {
    expect(request.capability).toBe("transcript-append")
    expect(request.intent).toBe("ingestion")
    return {
      store,
      accountId: 1,
      appendTranscripts: store.appendTranscripts,
      close: async () => {
        order.push("close")
      },
    }
  })
  deps.data = (text) => {
    order.push("output")
    output.push(text)
  }
  expect(await run(["recordings", "archive", "import", root, "--json"], deps)).toBe(0)
  expect(order[0]).toBe("close")
  expect(order.slice(1).every((step) => step === "output")).toBe(true)
  expect(JSON.parse(output.join("")).items[0].status).toBe("acknowledged")
  const stream: unknown[] = []
  deps.streamData = async (text) => {
    stream.push(JSON.parse(text))
  }
  expect(await run(["recordings", "archive", "import", root, "--jsonl"], deps)).toBe(0)
  expect(stream).toMatchObject([{ status: "acknowledged" }])
  expect(await store.meetings()).toHaveLength(1)
})

it("CLI leaves empty archives disconnected and rejects missing append connectors without stdout", async () => {
  const empty = await archiveFixture({ assets: 0 })
  const { deps, output } = await cli()
  expect(await run(["recordings", "archive", "import", empty.root, "--json"], deps)).toBe(0)
  expect(JSON.parse(output.join("")).items).toEqual([])
  output.length = 0
  const { root } = await archiveFixture()
  expect(await run(["recordings", "archive", "import", root, "--json"], deps)).toBe(3)
  setConfig(deps.configPath, "account.profile", "example")
  const close = vi.fn(async () => {})
  deps.connectStore = async () => ({ store: memoryMeetingStore(), accountId: 1, close })
  expect(await run(["recordings", "archive", "import", root, "--json"], deps)).toBe(3)
  expect(close).toHaveBeenCalledOnce()
  expect(output).toEqual([])
})

it("CLI preserves one acknowledged JSONL receipt after append cancellation and closes without another write", async () => {
  const first = await archiveFixture()
  await archiveFixture({ root: first.root, uuid: "example-second" })
  const { deps, output } = await cli()
  const controller = new AbortController()
  deps.signal = controller.signal
  setConfig(deps.configPath, "account.profile", "example")
  const store = memoryMeetingStore()
  const close = vi.fn(async () => {})
  const append = vi.fn(async (input: Parameters<typeof store.appendTranscripts>[0]) => {
    const details = await store.appendTranscripts(input)
    controller.abort()
    return details
  })
  deps.connectStore = async () => ({ store, accountId: 1, appendTranscripts: append, close })
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      output.push(String(chunk))
      done()
    },
  })
  deps.streamData = (text, signal) => writeStream(stdout, text, signal)
  expect(await run(["recordings", "archive", "import", first.root, "--jsonl"], deps)).toBe(130)
  expect(JSON.parse(output.join("")).status).toBe("acknowledged")
  expect(append).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})
