import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { parseMeetingReference } from "@wirecat/cli-core"
import { createMeetingContext, type MeetingMediaDescriptor, transcribeMeeting } from "@wirecat/cli-core/meetings"
import { memoryMeetingStore, sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { expect, it, vi } from "vitest"
import { readAnswer, readJsonlPage, readReceipt } from "../scripts/testing/answers.js"
import { fakeConnection } from "../scripts/testing/connection.js"
import { setConfig } from "./config.js"
import type { LocalTranscriptionOptions } from "./local-transcription.js"
import { type ProgramDeps, run } from "./program.js"
import type { StoreConnection } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-meeting-integration-cli-"))
  const output: string[] = [],
    errors: string[] = []
  const fail = async () => {
    throw new Error("unexpected external access")
  }
  const parts: Partial<StoreConnection> = {}
  const connect = vi.fn(async () =>
    fakeConnection({ store: {} as never, accountId: 1, close: async () => {}, ...parts }),
  )
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
  setConfig(deps.configPath, "account.profile", "AliceExample")
  parts.meetingIntegration = {
    change: async (reference, change, options) => {
      const parsed = parseMeetingReference(reference)
      if (parsed.accountId !== 1) throw new CliError("not_found", "unavailable for the selected account")
      return context.change(parsed.meetingId, change, options)
    },
  }
  return { deps, output, errors, writes, connect, parts }
}
const latest = (rows: string[]) => {
  const text = rows.at(-1) ?? "{}"
  if (text.startsWith('{"type":')) {
    const records = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    return records[0]?.data?.applied !== undefined ? readReceipt(text) : readJsonlPage(text)
  }
  const packet = JSON.parse(text)
  return "error" in packet || "commands" in packet ? packet : readAnswer(text)
}

it("previews links and applies owner-selected event and participant links once", async () => {
  const { deps, output, writes } = await setup()
  expect(
    await run(["meetings", "update", "meeting:1/1", "--event-id", "2", "--expected-event-id", "none", "--json"], deps),
  ).toBe(0)
  expect(latest(output)).toMatchObject({ applied: false, change: { event_id: 2, expected_event_id: null } })
  expect(writes).not.toHaveBeenCalled()
  expect(
    await run(
      ["meetings", "link", "meeting:1/1", "--participant-id", "3", "--person", "4", "--yes", "--dry-run", "--json"],
      deps,
    ),
  ).toBe(0)
  expect(latest(output)).toMatchObject({ applied: false, change: { person_uid: "4" } })
  expect(writes).not.toHaveBeenCalled()
  expect(
    await run(
      [
        "meetings",
        "update",
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
  expect(await run(["meetings", "update", "meeting:1/1", "--event-id", "none", "--yes", "--json"], deps)).toBe(0)
  expect(writes).toHaveBeenCalledTimes(1)
  expect(latest(output)).toMatchObject({ applied: true, change: { event_id: null } })
  expect(
    await run(
      [
        "meetings",
        "link",
        "meeting:1/1",
        "--participant-id",
        "3",
        "--person",
        "4",
        "--source",
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
    account_id: 1,
    applied: true,
    change: { participant_id: 3, person_uid: "4", target_account_ids: [1, 2], expected_person_uid: null },
  })
})

it("rejects malformed links before connecting and refuses foreign meeting scope", async () => {
  const { deps, writes, connect } = await setup()
  for (const args of [
    ["update", "meeting:1/1/2", "--event-id", "1"],
    ["update", "meeting:1/1", "--event-id", "0"],
    ["link", "meeting:1/1", "--participant-id", "0", "--person", "1"],
    ["link", "meeting:1/1", "--participant-id", "1", "--person", "Alice Example"],
    ["link", "meeting:1/1", "--participant-id", "1", "--person", "1", "--source", "0"],
    ["link", "meeting:1/1", "--participant-id", "1", "--person", "1", "--target-accounts", "1"],
  ])
    expect(await run(["meetings", ...args, "--yes", "--json"], deps)).toBe(2)
  expect(connect).not.toHaveBeenCalled()
  expect(await run(["meetings", "update", "meeting:2/1", "--event-id", "1", "--yes", "--json"], deps)).toBe(6)
  expect(writes).not.toHaveBeenCalled()
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
        "link",
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
  const { output, deps, parts } = await setup()
  const search = vi.fn(async () => ({
    items: [
      {
        ref: "meeting:1/1/1/0",
        meetingId: 1,
        scope: "transcript" as const,
        id: 1,
        text: "Alice Example plan",
        startMs: 0,
      },
    ],
    hasMore: true,
    nextCursor: "example_next",
    coverage: {
      archiveCompleteness: "unknown" as const,
      currentRevisions: true as const,
      indexing: "ready" as const,
      indexCompleteness: "unknown" as const,
    },
  }))
  parts.meetingSearch = search
  expect(
    await run(
      [
        "search",
        "meetings",
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
        "--event-id",
        "5",
        "--series-id",
        "6",
        "--since-time",
        "2026-10-01T00:00:00Z",
        "--until-time",
        "2026-10-11T12:00:00+02:00",
        "--limit",
        "2",
        "--cursor",
        "example_previous",
        "--max-read-bytes",
        "1024",
        "--jsonl",
      ],
      deps,
    ),
  ).toBe(0)
  expect(latest(output)).toMatchObject({
    items: [{ ref: "meeting:1/1/1/0", meeting: "meeting:1/1", offset_ms: 0, excerpt: "Alice Example plan" }],
    page: { has_more: true, next_cursor: "example_next" },
  })
  expect(search).toHaveBeenCalledWith(
    "example plan",
    expect.objectContaining({
      meetingId: 1,
      participantIdentityId: 12,
      personId: 34,
      project: "RES",
      tag: "planning",
      eventId: 5,
      meetingSeriesId: 6,
      since: Date.parse("2026-10-01T00:00:00Z"),
      until: Date.parse("2026-10-11T10:00:00Z"),
      limit: 2,
      after: "example_previous",
      maxReadBytes: 1024,
    }),
  )
  expect(await run(["search", "meetings", "example", "--topic", "costs", "--json"], deps)).toBe(0)
  expect(search).toHaveBeenLastCalledWith("example", expect.objectContaining({ topic: "costs" }))
})

it("rejects impossible search dates, oversized bounds and opaque cursor tampering before lookup", async () => {
  const { deps, connect, parts } = await setup()
  const search = vi.fn(async () => {
    throw new Error("unexpected search")
  })
  parts.meetingSearch = search
  for (const flags of [
    ["--limit", "0"],
    ["--limit", "1001"],
    ["--max-read-bytes", "67108865"],
    ["--meeting-id", "0"],
    ["--cursor", "not/a/cursor"],
    ["--since-time", "2026-02-30"],
    ["--since-time", "2026-10-11", "--until-time", "2026-10-01"],
    ["--event-id", "0"],
    ["--uuid", "example-uuid"],
    ["--max-chunks", "5"],
  ])
    expect(await run(["search", "meetings", "example", ...flags, "--json"], deps)).toBe(2)
  expect(await run(["search", "meetings", " ", "--json"], deps)).toBe(2)
  expect(search).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
})

it("retains memo as the shared note, tag and memory interface in command discovery", async () => {
  const { deps, output, connect } = await setup()
  expect(await run(["commands", "meetings", "--json"], deps)).toBe(0)
  const paths = latest(output).commands[0].commands.map((command: { path: string[] }) => command.path.join(" "))
  expect(paths.some((path: string) => /^meetings (notes|tags|memories)(?: |$)/.test(path))).toBe(false)
  expect(paths).toContain("meetings update")
  expect(paths).not.toContain("meetings search-page")
  expect(connect).not.toHaveBeenCalled()
})

it("mounts bounded local transcription with explicit model, guarded preview and a long deadline", async () => {
  const { deps, output, parts } = await setup()
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
  parts.meetingTranscription = { transcribe }
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
  expect(latest(output)).toMatchObject({ applied: true, inserted_transcripts: 1, meeting_id: saved.meeting.id })
  expect(JSON.stringify(latest(output))).not.toContain("Alice Example local recognition")
})
