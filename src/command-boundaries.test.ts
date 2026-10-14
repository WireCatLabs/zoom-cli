import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { fakeMeetingSource, memoryMeetingStore, sampleEvent, sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { expect, it } from "vitest"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const output: string[] = []
  const store = memoryMeetingStore()
  const fail = async (): Promise<never> => {
    throw new Error("unexpected external access")
  }
  const deps: ProgramDeps = {
    configPath: join(await mkdtemp(join(tmpdir(), "zm-test-boundaries-")), "config.json"),
    tokens: new TokenManager({ clientId: "example", service: "example", keyring: memoryKeyring(), fetch: fail }),
    fetch: fail,
    openBrowser: fail,
    store,
    accountId: 1,
    data: (text) => output.push(text),
    diagnostic: fail,
  }
  const invoke = async (args: string[]) => {
    output.length = 0
    expect(await run(args, deps)).toBe(0)
    return output
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((text) => JSON.parse(text))
  }
  return { deps, store, invoke }
}

it("keeps CLI paging, calendar filters and participant reads scoped to the selected account", async () => {
  const { store, invoke } = await setup()
  const first = await store.saveMeeting(sampleMeeting())
  const later = sampleMeeting()
  later.meeting.externalId = "example-later"
  later.meeting.startedAt = 2000
  await store.saveMeeting(later)
  const foreign = sampleMeeting()
  foreign.meeting.accountId = 2
  foreign.meeting.externalId = "example-foreign"
  await store.saveMeeting(foreign)
  const event = await store.createEvent(sampleEvent(), 3000)
  await store.linkMeeting(first.meeting.id, event.id, 3000, "owner")
  const before = await store.meeting(first.meeting.id)
  expect(
    await invoke([
      "meetings",
      "list",
      "started_at:[1970-01-01 TO 1970-01-02]",
      "--limit",
      "1",
      "--page",
      "2",
      "--jsonl",
    ]),
  ).toMatchObject([
    { items: [{ id: String(first.meeting.id), provider: "memory" }], page: { limit: 1, has_more: false } },
  ])
  expect((await invoke(["meetings", "people", "Alice", "--json"]))[0].items).toHaveLength(2)
  expect(await invoke(["meetings", "people", "Alice", "--jsonl"])).toHaveLength(2)
  expect((await invoke(["events", "list", "--json"]))[0].items).toEqual([event])
  expect(await invoke(["events", "list", "--jsonl"])).toEqual([event])
  expect(await store.meeting(first.meeting.id)).toEqual(before)
})

it("exports an explicitly selected historical revision and preserves JSONL item envelopes", async () => {
  const { store, invoke } = await setup()
  const original = await store.saveMeeting(sampleMeeting())
  const corrected = sampleMeeting()
  corrected.transcripts[0].contentHash = "corrected-example-hash"
  corrected.transcripts[0].rows[0].text = "Corrected invented plan."
  await store.saveMeeting(corrected)
  const id = String(original.meeting.id)
  expect((await invoke(["meetings", "show", id, "--json"]))[0].transcripts).toHaveLength(2)
  expect((await invoke(["meetings", "show", id, "--jsonl"]))[0].meeting.id).toBe(original.meeting.id)
  expect(await invoke(["meetings", "transcript", id, "--jsonl"])).toHaveLength(1)
  expect(await invoke(["meetings", "summary", id, "--jsonl"])).toHaveLength(1)
  const exported = await invoke([
    "meetings",
    "export",
    id,
    "--transcript-id",
    String(original.transcripts[0]?.transcript.id),
    "--format",
    "vtt",
    "--jsonl",
  ])
  expect(exported[0].content).toContain("Ship the example plan.")
  expect(exported[0].content).not.toContain("Corrected")
})

it("passes explicit lookback into shared ingestion and emits a single acknowledgement per JSONL import", async () => {
  const { deps, store, invoke } = await setup()
  const boundaries: string[] = []
  deps.source = fakeMeetingSource({
    meetings: async (since) => {
      boundaries.push(since)
      return []
    },
  })
  await store.setCursor(1, "2026-10-10T00:00:00.000Z", 3000)
  expect(await invoke(["meetings", "sync", "--lookback-days", "2", "--jsonl"])).toHaveLength(1)
  expect(boundaries).toEqual(["2026-10-08T00:00:00.000Z"])
  deps.readFiles = async () => [
    {
      name: "2026-10-10_1530_example.vtt",
      content: "WEBVTT\n\n00:00.000 --> 00:01.000\nAlice Example: Invented import\n",
    },
  ]
  expect(await invoke(["meetings", "import", "invented-folder", "--jsonl"])).toHaveLength(1)
  expect(await store.meetings({ accountId: 1 })).toHaveLength(1)
})
