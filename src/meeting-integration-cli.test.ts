import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { parseMeetingReference } from "@wirecat/cli-messaging"
import {
  createMeetingContext,
  dispatchMeetingMutation,
  type MeetingMediaDescriptor,
  transcribeMeeting,
} from "@wirecat/cli-messaging/meetings"
import { memoryMeetingStore, sampleMeeting } from "@wirecat/cli-messaging/meetings/testing"
import { expect, it, vi } from "vitest"
import { ZoomError } from "./errors.js"
import type { LocalTranscriptionOptions } from "./local-transcription.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-meeting-integration-cli-"))
  const output: string[] = [],
    errors: string[] = []
  const fail = async () => {
    throw new Error("unexpected external access")
  }
  const connect = vi.fn(fail)
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({ clientId: "example-client", service: "example", keyring: memoryKeyring(), fetch: fail }),
    fetch: fail,
    openBrowser: fail,
    connectStore: connect,
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
  }
  const writes = vi.fn(async (_meetingId: number, _change: unknown) => ({ changed: true }))
  const context = createMeetingContext({ provider: "zoom", account: "zm-profile:AliceExample" }, 1, {
    actions: ["event.link", "person.link"],
    apply: writes,
  })
  deps.meetingIntegration = {
    change: async (reference, change, options) => {
      const parsed = parseMeetingReference(reference)
      if (parsed.accountId !== 1) throw new ZoomError("not_found", "unavailable for the selected account")
      return context.change(parsed.meetingId, change, options)
    },
  }
  return { deps, output, errors, writes, connect }
}
const latest = (rows: string[]) => JSON.parse(rows.at(-1) ?? "{}")

it("previews links and applies owner-selected event and participant links once", async () => {
  const { deps, output, writes } = await setup()
  expect(
    await run(
      ["meetings", "link-event", "meeting:1/1", "--event-id", "2", "--expected-event-id", "none", "--json"],
      deps,
    ),
  ).toBe(0)
  expect(latest(output)).toMatchObject({ applied: false, change: { eventId: 2, expectedEventId: null } })
  expect(writes).not.toHaveBeenCalled()
  expect(
    await run(
      [
        "meetings",
        "link-person",
        "meeting:1/1",
        "--participant-id",
        "3",
        "--person",
        "4",
        "--yes",
        "--dry-run",
        "--json",
      ],
      deps,
    ),
  ).toBe(0)
  expect(latest(output)).toMatchObject({ applied: false, change: { personUid: "4" } })
  expect(writes).not.toHaveBeenCalled()
  expect(
    await run(
      [
        "meetings",
        "link-event",
        "meeting:1/1",
        "--event-id",
        "none",
        "--expected-event-id",
        "2",
        "--yes",
        "--dry-run",
        "--json",
      ],
      deps,
    ),
  ).toBe(0)
  expect(writes).not.toHaveBeenCalled()
  expect(await run(["meetings", "link-event", "meeting:1/1", "--event-id", "none", "--yes", "--json"], deps)).toBe(0)
  expect(writes).toHaveBeenCalledTimes(1)
  expect(latest(output)).toMatchObject({ applied: true, change: { eventId: null } })
  expect(
    await run(
      [
        "meetings",
        "link-person",
        "meeting:1/1",
        "--participant-id",
        "3",
        "--person",
        "4",
        "--target-accounts",
        "1, 2",
        "--expected-person",
        "none",
        "--yes",
        "--jsonl",
      ],
      deps,
    ),
  ).toBe(0)
  expect(writes).toHaveBeenCalledTimes(2)
  expect(latest(output)).toMatchObject({
    accountId: 1,
    applied: true,
    change: { participantId: 3, personUid: "4", targetAccountIds: [1, 2], expectedPersonUid: null },
  })
})

it("rejects malformed links before connecting and refuses foreign meeting scope", async () => {
  const { deps, writes, connect } = await setup()
  for (const args of [
    ["link-event", "meeting:1/1/2", "--event-id", "1"],
    ["link-event", "meeting:1/1", "--event-id", "0"],
    ["link-person", "meeting:1/1", "--participant-id", "0", "--person", "1"],
    ["link-person", "meeting:1/1", "--participant-id", "1", "--person", "Alice Example"],
    ["link-person", "meeting:1/1", "--participant-id", "1", "--person", "1", "--target-accounts", "0"],
  ])
    expect(await run(["meetings", ...args, "--yes", "--json"], deps)).toBe(2)
  expect(await run(["meetings", "link-event", "meeting:2/1", "--event-id", "1", "--yes", "--json"], deps)).toBe(6)
  expect(writes).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
})

it("preserves an acknowledged link receipt when cancellation follows commit", async () => {
  const { deps, output, errors, writes } = await setup()
  const abort = new AbortController()
  deps.signal = abort.signal
  writes.mockImplementation(async () => {
    abort.abort()
    return { changed: true }
  })
  expect(
    await run(
      [
        "meetings",
        "link-person",
        "meeting:1/1",
        "--participant-id",
        "3",
        "--person",
        "4",
        "--expected-person",
        "5",
        "--yes",
        "--jsonl",
      ],
      deps,
    ),
  ).toBe(130)
  expect(writes).toHaveBeenCalledTimes(1)
  expect(latest(output)).toMatchObject({ applied: true, result: { changed: true } })
  expect(latest(errors).error.code).toBe("cancelled")
})

it("keeps bounded search cursors and coverage in JSONL and forwards typed date/budget filters", async () => {
  const { deps, output, connect } = await setup()
  const search = vi.fn(async () => ({
    items: [{ meetingId: 1, scope: "transcript" as const, id: 1, text: "Alice Example plan", startMs: 0 }],
    hasMore: true,
    nextCursor: "example_next",
    coverage: {
      archiveCompleteness: "unknown" as const,
      currentRevisions: true as const,
      indexing: "ready" as const,
      indexCompleteness: "unknown" as const,
    },
  }))
  deps.meetingSearch = search
  expect(
    await run(
      [
        "meetings",
        "search-page",
        "example plan",
        "--identity-id",
        "12",
        "--person-id",
        "34",
        "--project",
        "RES",
        "--tag",
        "planning",
        "--meeting-id",
        "1",
        "--since",
        "2026-10-01",
        "--until",
        "2026-10-11T12:00:00+02:00",
        "--limit",
        "2",
        "--after",
        "example_previous",
        "--max-read-bytes",
        "1024",
        "--jsonl",
      ],
      deps,
    ),
  ).toBe(0)
  expect(latest(output)).toMatchObject({
    hasMore: true,
    nextCursor: "example_next",
    coverage: { archiveCompleteness: "unknown" },
  })
  expect(search).toHaveBeenCalledWith(
    "example plan",
    expect.objectContaining({
      meetingId: 1,
      participantIdentityId: 12,
      personId: 34,
      project: "RES",
      tag: "planning",
      since: Date.parse("2026-10-01T00:00:00Z"),
      until: Date.parse("2026-10-11T10:00:00Z"),
      limit: 2,
      after: "example_previous",
      maxReadBytes: 1024,
    }),
  )
  expect(await run(["meetings", "search-page", "example", "--topic", "costs", "--json"], deps)).toBe(0)
  expect(search).toHaveBeenLastCalledWith("example", expect.objectContaining({ topic: "costs" }))
  expect(connect).not.toHaveBeenCalled()
})

it("rejects impossible search dates, oversized bounds and opaque cursor tampering before lookup", async () => {
  const { deps, connect } = await setup()
  const search = vi.fn(async () => {
    throw new Error("unexpected search")
  })
  deps.meetingSearch = search
  for (const flags of [
    ["--limit", "0"],
    ["--limit", "1001"],
    ["--max-read-bytes", "67108865"],
    ["--meeting-id", "0"],
    ["--after", "not/a/cursor"],
    ["--since", "2026-02-30"],
    ["--since", "2026-10-11", "--until", "2026-10-01"],
  ])
    expect(await run(["meetings", "search-page", "example", ...flags, "--json"], deps)).toBe(2)
  expect(await run(["meetings", "search-page", " ", "--json"], deps)).toBe(2)
  expect(search).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
})

it("indexes only explicit bounded batches and preserves the applied receipt", async () => {
  const { deps, output } = await setup()
  const write = vi.fn(async () => ({ indexed: 2, remaining: 1 }))
  deps.meetingSearchIndex = async (options) => {
    const request = { limit: options.limit ?? 100, maxReadBytes: options.maxReadBytes ?? 4194304 }
    const outcome = await dispatchMeetingMutation(options, write)
    return { applied: outcome.applied, accountId: 1, request, ...(outcome.value ?? {}) }
  }
  const args = ["meetings", "search-index", "--limit", "2", "--max-read-bytes", "1024", "--json"]
  expect(await run(args, deps)).toBe(0)
  expect(latest(output)).toMatchObject({ applied: false, request: { limit: 2, maxReadBytes: 1024 } })
  expect(write).not.toHaveBeenCalled()
  expect(await run([...args, "--yes", "--dry-run"], deps)).toBe(0)
  expect(write).not.toHaveBeenCalled()
  expect(await run([...args, "--yes"], deps)).toBe(0)
  expect(latest(output)).toMatchObject({ applied: true, indexed: 2, remaining: 1 })
  expect(write).toHaveBeenCalledTimes(1)
})

it("retains memo as the shared note, tag and memory interface in command discovery", async () => {
  const { deps, output, connect } = await setup()
  expect(await run(["commands", "meetings", "--json"], deps)).toBe(0)
  const paths = latest(output).commands[0].commands.map((command: { path: string[] }) => command.path.join(" "))
  expect(paths.some((path: string) => /^meetings (notes|tags|memories)(?: |$)/.test(path))).toBe(false)
  expect(paths).toContain("meetings link-event")
  expect(paths).toContain("meetings search-page")
  expect(connect).not.toHaveBeenCalled()
})

it("mounts bounded local transcription with explicit model, guarded preview and a long deadline", async () => {
  const { deps, output } = await setup()
  const store = memoryMeetingStore()
  const saved = await store.saveMeeting(sampleMeeting())
  const media: MeetingMediaDescriptor = {
    id: "example-audio",
    contentHash: "a".repeat(64),
    size: 1000,
    durationMs: 1000,
    format: "wav",
    sampleRate: 16000,
    channels: 1,
    recognition: { engine: "example-local", model: "parakeet-v3", timing: "fixed-windows" },
  }
  const recognize = vi.fn()
  const append = vi.fn(async (input: Parameters<typeof store.appendTranscripts>[0]) => ({
    meeting: await store.appendTranscripts(input),
    created: false,
    insertedTranscripts: 1,
    replayedTranscripts: 0,
    supersededTranscripts: 0,
  }))
  const transcribe = vi.fn(async (_reference: string, _file: string, options: LocalTranscriptionOptions) =>
    transcribeMeeting(
      {
        describe: async () => media,
        segments: async function* () {
          recognize()
          yield { startMs: 0, endMs: 1000, text: "Alice Example local recognition" }
        },
      },
      { appendTranscriptsWithReceipt: append },
      { accountId: 1, externalId: saved.meeting.externalId, now: 5000 },
      options,
    ),
  )
  deps.meetingTranscription = { transcribe }
  const deadlines: number[] = []
  deps.sleep = async (ms, signal) =>
    new Promise((_resolve, reject) => {
      deadlines.push(ms)
      signal?.addEventListener("abort", () => reject(new Error("disposed")), { once: true })
    })
  const args = [
    "meetings",
    "transcribe",
    "meeting:1/1",
    "/example/AliceExample.wav",
    "--model",
    "parakeet-v3",
    "--models-dir",
    "/example/installed-models",
    "--max-bytes",
    "1024",
    "--max-duration",
    "1m",
    "--max-segments",
    "2",
    "--max-text-bytes",
    "1024",
    "--json",
  ]
  expect(await run([...args, "--yes", "--dry-run"], deps)).toBe(0)
  expect(latest(output)).toMatchObject({ applied: false, media: { id: media.id } })
  expect(append).not.toHaveBeenCalled()
  expect(recognize).not.toHaveBeenCalled()
  expect(transcribe).toHaveBeenCalledWith(
    "meeting:1/1",
    "/example/AliceExample.wav",
    expect.objectContaining({
      model: "parakeet-v3",
      modelsDirectory: "/example/installed-models",
      maxDurationMs: 60000,
      maxBytes: 1024,
      maxSegments: 2,
      maxTextBytes: 1024,
    }),
  )
  expect(deadlines).toEqual([3600000])
  expect(await run([...args, "--yes"], deps)).toBe(0)
  expect(recognize).toHaveBeenCalledTimes(1)
  expect(append).toHaveBeenCalledTimes(1)
  expect(latest(output)).toMatchObject({ applied: true, insertedTranscripts: 1, meetingId: saved.meeting.id })
  expect(JSON.stringify(latest(output))).not.toContain("Alice Example local recognition")
})
