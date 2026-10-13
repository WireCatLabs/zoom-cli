import { createHash } from "node:crypto"
import { mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { expect, it, vi } from "vitest"
import type { ArchiveTranscript } from "./archive-transcripts.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-offline-cli-"))
  const output: string[] = [],
    errors: string[] = []
  const fail = async () => {
    throw new Error("unexpected external IO")
  }
  const deps: ProgramDeps = {
    configPath: join(directory, "invalid-config.json"),
    tokens: new TokenManager({ clientId: "example-client", keyring: memoryKeyring(), service: "example", fetch: fail }),
    fetch: vi.fn(fail),
    openBrowser: vi.fn(fail),
    connectStore: vi.fn(fail),
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
  }
  await writeFile(deps.configPath, "invalid JSON")
  const uuid = "example-occurrence"
  const files = []
  const paths: string[] = []
  for (const [id, text] of [
    [
      "example-first",
      "WEBVTT\n\n00:00.000 --> 00:02.000\nAlice Example: Café [Plan]\n\n00:02.000 --> 00:03.000\nOther Example: Second PLAN\n",
    ],
    ["example-second", "WEBVTT\n\n00:00.000 --> 00:01.000\nAlice Example: Third plan\n"],
  ] as const) {
    const name = `${digest(uuid)}-${digest(id)}.vtt`
    const path = join(directory, name)
    paths.push(path)
    await writeFile(path, text)
    files.push({
      id,
      path: name,
      size: Buffer.byteLength(text),
      sha256: digest(text),
      remoteSize: null,
      type: "audio_transcript",
      format: "vtt",
      startedAt: null,
      endedAt: null,
    })
  }
  await writeFile(
    join(directory, `.zoom-archive-${digest(uuid)}.json`),
    JSON.stringify({ version: 1, meeting: { id: "123456", uuid, title: "Example archive", startedAt: null }, files }),
  )
  return { deps, directory, output, errors, paths, uuid }
}
const latest = (output: string[]) => JSON.parse(output.join("") || "{}")

it("reads verified local archive cues as finite listed JSON without config, credentials or database access", async () => {
  const { deps, directory, output, paths, uuid } = await setup()
  const timestamp = (await stat(paths[0] ?? "")).mtimeMs
  const load = vi.spyOn(deps.tokens, "load")
  expect(await run(["recordings", "archive", "transcript", directory, "--offline", "--json"], deps)).toBe(0)
  expect(latest(output)).toMatchObject({ page: 1, limit: 2, has_more: false })
  expect(latest(output).items).toHaveLength(2)
  expect(latest(output).items[0]).toMatchObject({
    meeting: { uuid },
    cues: [{ speaker: "Alice Example", text: "Café [Plan]" }, { text: "Second PLAN" }],
  })
  expect((await stat(paths[0] ?? "")).mtimeMs).toBe(timestamp)
  expect(load).not.toHaveBeenCalled()
  expect(deps.fetch).not.toHaveBeenCalled()
  expect(deps.connectStore).not.toHaveBeenCalled()
  expect(deps.openBrowser).not.toHaveBeenCalled()
})

it("projects archive fields, supports finite JSONL and preserves true search paging metadata", async () => {
  const { deps, directory, output, uuid } = await setup()
  expect(
    await run(
      [
        "recordings",
        "archive",
        "transcript",
        directory,
        "--uuid",
        uuid,
        "--file-ids",
        "example-first",
        "--fields",
        "meeting.uuid,cues",
        "--jsonl",
      ],
      deps,
    ),
  ).toBe(0)
  const item = latest(output)
  expect(item.meeting).toEqual({ uuid })
  expect(item.cues).toHaveLength(2)
  expect(item).not.toHaveProperty("asset")
  output.length = 0
  expect(
    await run(
      [
        "search",
        "meetings",
        "PLAN",
        "--archive",
        directory,
        "--uuid",
        uuid,
        "--file-ids",
        "example-first",
        "--max-bytes",
        "4096",
        "--limit",
        "1",
        "--fields",
        "text,position",
        "--json",
      ],
      deps,
    ),
  ).toBe(0)
  expect(latest(output)).toMatchObject({
    page: 1,
    limit: 1,
    has_more: true,
    items: [{ text: "Café [Plan]", position: 0 }],
  })
  expect(latest(output).items[0]).not.toHaveProperty("asset")
  output.length = 0
  expect(await run(["search", "meetings", "Cafe\u0301", "--archive", directory, "--json"], deps)).toBe(0)
  expect(latest(output)).toMatchObject({ has_more: false, items: [{ text: "Café [Plan]" }] })
  output.length = 0
  expect(await run(["search", "meetings", "not present", "--archive", directory, "--json"], deps)).toBe(0)
  expect(latest(output)).toMatchObject({ items: [], has_more: false })
})

it("reports corruption, byte bounds and unknown selectors without emitting partial finite output", async () => {
  const { deps, directory, output, paths } = await setup()
  for (const args of [
    ["--max-bytes", "10"],
    ["--uuid", "unknown-example"],
    ["--file-ids", "unknown-asset"],
  ]) {
    const code = args[0] === "--max-bytes" ? 2 : 6
    expect(await run(["recordings", "archive", "transcript", directory, ...args, "--json"], deps)).toBe(code)
    expect(output).toEqual([])
  }
  const second = paths[1] ?? ""
  await writeFile(second, "WEBVTT\n\n00:00.000 --> 00:01.000\nAlice Example: Wrong plan\n")
  expect(await run(["recordings", "archive", "transcript", directory, "--jsonl"], deps)).toBe(2)
  expect(output).toEqual([])
  output.length = 0
  expect(await run(["search", "meetings", "plan", "--archive", directory, "--limit", "1001", "--json"], deps)).toBe(2)
  expect(output).toEqual([])
  for (const flags of [
    ["--since-time", "2026-10-01"],
    ["--event-id", "1"],
    ["--model", "e5-small"],
    ["--cursor", "1"],
  ])
    expect(await run(["search", "meetings", "plan", "--archive", directory, ...flags, "--json"], deps)).toBe(2)
  expect(output).toEqual([])
})

it("stops a finite transcript iterator at the output limit and preserves projected bounded results", async () => {
  const { deps, directory, output } = await setup()
  let advanced = 0,
    closed = 0
  const item: ArchiveTranscript = {
    meeting: { id: "123456", uuid: "example-large", title: "Example", startedAt: null },
    asset: {
      id: "example",
      path: "example.vtt",
      size: 1,
      sha256: "a".repeat(64),
      remoteSize: null,
      type: "audio_transcript",
      format: "vtt",
      startedAt: null,
      endedAt: null,
    },
    cues: [{ speaker: "Example", startMs: 0, endMs: 1000, text: "Example content ".repeat(1000) }],
  }
  deps.archiveTranscripts = {
    search: async () => ({ items: [], page: 1, limit: 1, hasMore: false }),
    read: async function* () {
      try {
        advanced++
        yield item
        advanced++
        yield item
      } finally {
        closed++
      }
    },
  }
  expect(
    await run(["recordings", "archive", "transcript", directory, "--max-output-bytes", "500", "--json"], deps),
  ).toBe(13)
  expect(output).toEqual([])
  expect(advanced).toBe(1)
  expect(closed).toBe(1)
  expect(
    await run(
      [
        "recordings",
        "archive",
        "transcript",
        directory,
        "--max-output-bytes",
        "500",
        "--fields",
        "meeting.uuid",
        "--json",
      ],
      deps,
    ),
  ).toBe(0)
  expect(latest(output)).toMatchObject({
    limit: 2,
    items: [{ meeting: { uuid: "example-large" } }, { meeting: { uuid: "example-large" } }],
  })
})

it("discards cancellation output and keeps default terminal rendering on the shared renderer", async () => {
  const { deps, directory, output } = await setup()
  const controller = new AbortController()
  controller.abort(new CliError("cancelled", "example offline cancellation"))
  expect(
    await run(["recordings", "archive", "transcript", directory, "--json"], { ...deps, signal: controller.signal }),
  ).toBe(130)
  expect(output).toEqual([])
  expect(await run(["recordings", "archive", "transcript", directory], { ...deps, outputIsTTY: true })).toBe(0)
  expect(output.join("")).toContain("Example archive")
  expect(output.join("")).toContain("has_more")
})

it("keeps empty transcript envelopes and multi-asset JSONL framing valid", async () => {
  const { deps, directory, output } = await setup()
  const empty = await mkdtemp(join(tmpdir(), "zm-test-empty-archive-cli-"))
  expect(await run(["recordings", "archive", "transcript", empty], deps)).toBe(0)
  expect(latest(output)).toEqual({ items: [], page: 1, limit: 0, has_more: false })
  output.length = 0
  expect(await run(["recordings", "archive", "transcript", empty, "--jsonl"], deps)).toBe(0)
  expect(output).toEqual([])
  expect(await run(["recordings", "archive", "transcript", directory, "--fields", "asset.id", "--jsonl"], deps)).toBe(0)
  expect(
    output
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toEqual([{ asset: { id: "example-first" } }, { asset: { id: "example-second" } }])
})
