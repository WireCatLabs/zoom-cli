import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Writable } from "node:stream"
import { memoryKeyring } from "@wirecat/cli-base"
import { expect, it, vi } from "vitest"
import { setConfig } from "./config.js"
import {
  createMeetingContextCapabilities,
  validateEvidenceOptions,
  validatePersonContext,
  validateTaskKind,
  validateTaskProposal,
} from "./meeting-context.js"
import type { MeetingEmbeddingOptions } from "./meeting-semantic-commands.js"
import { type ProgramDeps, run } from "./program.js"
import { writeStream } from "./streaming.js"
import { TokenManager } from "./tokens.js"

const api = vi.hoisted(() => ({
  parseMeetingReference: vi.fn((text: string) => ({
    type: "meeting" as const,
    accountId: Number(text.slice(8).split("/")[0]),
    meetingId: 15,
  })),
  canonicalMeetingReference: vi.fn((text: string) => text),
  readMeetingEvidence: vi.fn(),
  personMeetingContext: vi.fn(),
  proposeMeetingTask: vi.fn(),
}))
vi.mock("@wirecat/cli-messaging", () => ({
  parseMeetingReference: api.parseMeetingReference,
  canonicalMeetingReference: api.canonicalMeetingReference,
}))
vi.mock("@wirecat/cli-messaging/services", () => ({
  readMeetingEvidence: api.readMeetingEvidence,
  personMeetingContext: api.personMeetingContext,
  proposeMeetingTask: api.proposeMeetingTask,
}))
const readStore = (meetingMetadata = vi.fn()) => ({
  meetingMetadata,
  transcriptMetadata: vi.fn(),
  transcripts: vi.fn(),
  transcriptRows: vi.fn(),
})
const reference = "meeting:3/15/20/0"
const evidence = {
  schemaVersion: 1 as const,
  kind: "meeting" as const,
  source: reference,
  fingerprint: "example-fingerprint",
  limits: { cues: 100, bytes: 65536, maxReadBytes: 4194304, maxTranscriptPages: 100 },
  contentBytes: 2,
  items: [],
  coverage: {
    provided: 0,
    included: 0,
    omitted: null,
    providedExact: false,
    nextReference: null,
    nextTranscriptId: null,
    transcriptPages: 0,
    skippedUnavailable: 0,
    hasMore: false,
    truncatedBy: null,
    input: "bounded-meeting-pages" as const,
    archiveCompleteness: "unknown" as const,
  },
}
const proposal = {
  id: "example-proposal",
  source: reference,
  sourceKind: "meeting" as const,
  group: "meeting:3/15",
  accountId: 3,
  kind: "promise" as const,
  preview: null,
  revision: "current" as const,
  applied: false as const,
  persistence: "proposal-only" as const,
}
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-meeting-context-"))
  const output: string[] = []
  const deps: ProgramDeps = {
    configPath: join(root, "config.json"),
    tokens: new TokenManager({
      clientId: "example",
      keyring: memoryKeyring(),
      service: "example",
      fetch: async () => {
        throw new Error("unexpected token")
      },
    }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => output.push(text),
    diagnostic: () => {},
  }
  return { deps, output }
}

it("binds public producer evidence and person context to the selected account before any meeting read", async () => {
  api.readMeetingEvidence.mockResolvedValue(evidence)
  api.personMeetingContext.mockResolvedValue({
    person: { uid: "7", name: "Alice Example" },
    items: [],
    coverage: { complete: false, pending: 2, skippedUnavailable: 1 },
  })
  api.proposeMeetingTask.mockResolvedValue(proposal)
  const meeting = vi.fn()
  const full = {
    personByUid: vi.fn(async () => undefined),
    personSeenInAccounts: vi.fn(async () => true),
    involvements: {
      rebuild: vi.fn(() => 0),
      drain: vi.fn(() => ({ recomputed: 0, pending: 0 })),
      pending: vi.fn(() => 0),
      forPerson: vi.fn(() => []),
    },
  }
  const callbacks = createMeetingContextCapabilities(full, readStore(meeting), 3)
  expect(await callbacks.evidence?.(reference)).toEqual(evidence)
  expect(api.readMeetingEvidence).toHaveBeenCalledWith(
    expect.objectContaining({ meetingMetadata: meeting }),
    3,
    reference,
    expect.any(Object),
  )
  const reads = api.readMeetingEvidence.mock.calls.length
  await expect(callbacks.evidence?.("meeting:99/15")).rejects.toMatchObject({ code: "not_found" })
  await expect(callbacks.evidence?.("meeting:3/15", { after: "meeting:99/15/20/0" })).rejects.toMatchObject({
    code: "not_found",
  })
  expect(api.readMeetingEvidence).toHaveBeenCalledTimes(reads)
  expect(meeting).not.toHaveBeenCalled()
  await callbacks.personContext?.("person:7", { accountIds: [99] } as never)
  expect(api.personMeetingContext).toHaveBeenLastCalledWith(
    expect.objectContaining({
      meetings: expect.objectContaining({ meetingMetadata: meeting }),
      involvements: full.involvements,
    }),
    "person:7",
    expect.objectContaining({ accountIds: [3] }),
  )
  expect(await callbacks.taskProposal?.(reference, "promise")).toEqual(proposal)
  expect(api.proposeMeetingTask).toHaveBeenCalledWith(
    expect.objectContaining({ meetingMetadata: meeting }),
    3,
    reference,
    "promise",
  )
})

it("reports unavailable public capabilities without inventing fallback evidence", async () => {
  const meeting = vi.fn()
  const context = createMeetingContextCapabilities({}, readStore(meeting), 3, async () => ({}))
  await expect(context.evidence?.(reference)).rejects.toMatchObject({ code: "configuration_error" })
  await expect(context.personContext?.("person:7")).rejects.toMatchObject({ code: "configuration_error" })
  await expect(context.taskProposal?.(reference, "promise")).rejects.toMatchObject({ code: "configuration_error" })
  const parser = {
    parseMeetingReference: () => ({ type: "meeting" as const, accountId: 3, meetingId: 15 }),
    canonicalMeetingReference: (value: string) => value,
  }
  const missingService = createMeetingContextCapabilities({}, readStore(meeting), 3, async () => parser)
  await expect(missingService.evidence?.(reference)).rejects.toMatchObject({ code: "configuration_error" })
  await expect(missingService.taskProposal?.(reference, "promise")).rejects.toMatchObject({
    code: "configuration_error",
  })
  expect(meeting).not.toHaveBeenCalled()
})

it("validates limits, person identifiers and unapplied task kinds before context work", () => {
  for (const options of [
    { cues: 0 },
    { cues: 1001 },
    { bytes: 1 },
    { bytes: 4194305 },
    { afterTranscriptId: 0 },
    { after: "meeting:3/15/20/0", afterTranscriptId: 20 },
  ])
    expect(() => validateEvidenceOptions(options)).toThrow()
  for (const [person, options] of [
    ["person:0", {}],
    ["person:abc", {}],
    ["person:7", { meetings: 0 }],
    ["person:7", { scanLimit: 1001 }],
    ["person:7", { since: 1.5 }],
  ] as const)
    expect(() => validatePersonContext(person, options)).toThrow()
  expect(() => validateTaskKind("invalid")).toThrow()
  expect(() => validateTaskProposal({ ...proposal, applied: true })).toThrow()
  expect(() => createMeetingContextCapabilities({}, readStore(), 0)).toThrow()
})

it("stops cancelled context callbacks before reads and discards late cancelled evidence", async () => {
  const controller = new AbortController()
  const read = vi.fn(async () => {
    controller.abort()
    return evidence
  })
  const parser = {
    parseMeetingReference: () => ({ type: "meeting" as const, accountId: 3, meetingId: 15 }),
    canonicalMeetingReference: (value: string) => value,
  }
  const context = createMeetingContextCapabilities({}, readStore(), 3, async () => ({
    ...parser,
    readMeetingEvidence: vi.fn().mockImplementation(read),
  }))
  await expect(context.evidence?.(reference, { signal: controller.signal })).rejects.toMatchObject({
    code: "cancelled",
  })
  await expect(context.evidence?.(reference, { signal: controller.signal })).rejects.toMatchObject({
    code: "cancelled",
  })
  expect(read).toHaveBeenCalledOnce()
})

it("CLI forwards complete context envelopes and proposal-only previews with no automatic task creation", async () => {
  const { deps, output } = await setup()
  deps.meetingContext = {
    evidence: vi.fn(async () => evidence),
    personContext: vi.fn(async () => ({ items: [], coverage: { complete: false, pending: 2 } })),
    taskProposal: async () => proposal,
  }
  expect(await run(["meetings", "evidence", reference, "--jsonl"], deps)).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}")).toEqual(evidence)
  expect(
    await run(
      [
        "meetings",
        "evidence",
        "meeting:3/15",
        "--cursor",
        reference,
        "--max-read-bytes",
        "1000",
        "--max-transcript-pages",
        "2",
        "--cues",
        "3",
        "--bytes",
        "512",
        "--json",
      ],
      deps,
    ),
  ).toBe(0)
  expect(await run(["meetings", "evidence", "meeting:3/15", "--after-transcript-id", "20", "--json"], deps)).toBe(0)
  expect(deps.meetingContext.evidence).toHaveBeenLastCalledWith(
    "meeting:3/15",
    expect.objectContaining({ afterTranscriptId: 20 }),
  )
  expect(deps.meetingContext.evidence).toHaveBeenCalledWith(
    "meeting:3/15",
    expect.objectContaining({ after: reference, maxReadBytes: 1000, maxTranscriptPages: 2, cues: 3, bytes: 512 }),
  )
  expect(
    await run(
      [
        "meetings",
        "context",
        "person:7",
        "--meetings",
        "2",
        "--since-time",
        "2026-10-10T00:00:00.000Z",
        "--scan-limit",
        "20",
        "--cues",
        "3",
        "--bytes",
        "512",
        "--json",
      ],
      deps,
    ),
  ).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}").coverage.complete).toBe(false)
  expect(deps.meetingContext.personContext).toHaveBeenCalledWith(
    "person:7",
    expect.objectContaining({
      meetings: 2,
      since: Date.parse("2026-10-10T00:00:00.000Z"),
      scanLimit: 20,
      cues: 3,
      bytes: 512,
    }),
  )
  expect(await run(["meetings", "task-proposal", reference, "--type", "promise", "--json"], deps)).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}").applied).toBe(false)
  const serve = vi.fn(async () => {})
  deps.serveMcp = serve
  expect(await run(["serve", "--mcp", "--meeting-context"], deps)).toBe(0)
  expect(serve).toHaveBeenCalledWith(expect.objectContaining({ includeMeetingContext: true }))
  serve.mockClear()
  expect(await run(["serve", "--mcp", "--unified-search"], deps)).toBe(0)
  expect(serve).toHaveBeenCalledWith(expect.objectContaining({ includeUnifiedSearch: true }))
})

it("CLI validates before connection, uses one read connection, closes before stdout, and detects missing capabilities", async () => {
  const { deps, output } = await setup()
  const close = vi.fn(async () => {
    expect(output).toEqual([])
  })
  const connect = vi.fn(async () => ({
    store: {} as never,
    accountId: 3,
    meetingContext: { evidence: async () => evidence },
    close,
  }))
  deps.connectStore = connect
  expect(await run(["meetings", "context", "person:0", "--json"], deps)).toBe(2)
  expect(await run(["meetings", "evidence", reference, "--cues", "0", "--json"], deps)).toBe(2)
  expect(await run(["meetings", "task-proposal", reference, "--type", "invalid", "--json"], deps)).toBe(2)
  expect(await run(["meetings", "context", "person:7", "--since-time", "invalid", "--json"], deps)).toBe(2)
  expect(connect).not.toHaveBeenCalled()
  expect(await run(["meetings", "evidence", reference, "--json"], deps)).toBe(3)
  setConfig(deps.configPath, "account.profile", "example")
  expect(await run(["meetings", "evidence", reference, "--json"], deps)).toBe(0)
  expect(connect).toHaveBeenCalledOnce()
  expect(connect).toHaveBeenCalledWith({ profile: "example", externalId: "zm-profile:example", intent: "read" })
  expect(close).toHaveBeenCalledOnce()
  output.length = 0
  deps.meetingContext = {}
  for (const args of [
    ["evidence", reference],
    ["context", "person:7"],
    ["task-proposal", reference, "--type", "promise"],
  ])
    expect(await run(["meetings", ...args, "--json"], deps)).toBe(3)
  expect(output).toEqual([])
})

it("requires an explicit semantic model, preserves scan coverage, and previews generation until --yes", async () => {
  const { deps, output } = await setup()
  const report = { items: [], ranking: "scanned-candidates", complete: false, hasMore: true, nextChunkId: 12 }
  const search = vi.fn(async () => report)
  const generate = vi.fn(async (options: MeetingEmbeddingOptions) => ({ applied: options.yes === true }))
  deps.meetingSemantic = { search, generate }
  expect(await run(["meetings", "semantic", "example", "--json"], deps)).toBe(2)
  expect(
    await run(["meetings", "semantic", "example", "--model", "installed-example", "--max-chunks", "10001"], deps),
  ).toBe(2)
  expect(
    await run(
      ["meetings", "semantic", "example", "--model", "served-example", "--base-url", "https://example.invalid/v1"],
      deps,
    ),
  ).toBe(2)
  for (const [baseUrl, dims] of [
    ["https://example-user@example.invalid/v1", "2"],
    ["https://example.invalid/v1", "8193"],
  ] as const)
    expect(
      await run(
        ["meetings", "semantic", "example", "--model", "served-example", "--base-url", baseUrl, "--dims", dims],
        deps,
      ),
    ).toBe(2)
  expect(search).not.toHaveBeenCalled()
  expect(
    await run(
      [
        "meetings",
        "semantic",
        "example",
        "--model",
        "installed-example",
        "--after-chunk-id",
        "4",
        "--limit",
        "2",
        "--max-chunks",
        "10",
        "--max-rows",
        "20",
        "--max-text-bytes",
        "1000",
        "--jsonl",
      ],
      deps,
    ),
  ).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}")).toEqual(report)
  expect(search).toHaveBeenCalledWith(
    "example",
    expect.objectContaining({
      model: "installed-example",
      afterChunkId: 4,
      limit: 2,
      maxChunks: 10,
      maxRows: 20,
      maxTextBytes: 1000,
    }),
  )
  expect(await run(["meetings", "embeddings", "--model", "installed-example", "--json"], deps)).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}").applied).toBe(false)
  expect(generate).toHaveBeenLastCalledWith(expect.not.objectContaining({ yes: true }))
  expect(
    await run(
      [
        "meetings",
        "embeddings",
        "--model",
        "served-example",
        "--base-url",
        "https://example.invalid/v1",
        "--dims",
        "2",
        "--yes",
        "--limit",
        "2",
        "--after-transcript-id",
        "15",
        "--after-hash",
        "a".repeat(64),
        "--max-rows",
        "20",
        "--max-text-bytes",
        "1000",
        "--json",
      ],
      deps,
    ),
  ).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}").applied).toBe(true)
  expect(generate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      model: "served-example",
      baseUrl: "https://example.invalid/v1",
      dims: 2,
      yes: true,
      limit: 2,
      afterTranscriptId: 15,
      afterHash: "a".repeat(64),
      maxRows: 20,
      maxTextBytes: 1000,
    }),
  )
  expect(search).toHaveBeenCalledOnce()
})

it("refuses remote semantic models offline before connecting, querying, generating or starting MCP", async () => {
  const { deps, output } = await setup()
  const connect = vi.fn()
  const search = vi.fn()
  const generate = vi.fn()
  const serve = vi.fn()
  deps.connectStore = connect
  deps.meetingSemantic = { search, generate }
  deps.serveMcp = serve
  const remote = ["--model", "served-example", "--base-url", "https://example.invalid/v1", "--dims", "2"]
  for (const args of [
    ["meetings", "semantic", "example", ...remote],
    ["meetings", "embeddings", ...remote],
    ["meetings", "embeddings", ...remote, "--yes"],
    ["serve", "--mcp", "--semantic", ...remote],
  ])
    expect(await run([...args, "--offline"], deps)).toBe(3)
  expect(connect).not.toHaveBeenCalled()
  expect(search).not.toHaveBeenCalled()
  expect(generate).not.toHaveBeenCalled()
  expect(serve).not.toHaveBeenCalled()
  expect(output).toEqual([])
  search.mockResolvedValue({ items: [] })
  expect(
    await run(["meetings", "semantic", "example", "--model", "installed-example", "--offline", "--json"], deps),
  ).toBe(0)
  expect(search).toHaveBeenCalledOnce()
})

it("flushes acknowledged embedding writes after cancellation while discarding cancelled query output", async () => {
  const { deps, output } = await setup()
  const controller = new AbortController()
  deps.signal = controller.signal
  const report = { applied: true, saved: 2, skipped: 1 }
  deps.meetingSemantic = {
    search: vi.fn(),
    generate: async () => {
      controller.abort()
      return report
    },
  }
  let callbackSettled = false
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      output.push(String(chunk))
      setTimeout(() => {
        callbackSettled = true
        callback()
      }, 10)
    },
  })
  deps.streamData = (text, signal) => writeStream(stream, text, signal)
  expect(await run(["meetings", "embeddings", "--model", "installed-example", "--yes", "--jsonl"], deps)).toBe(130)
  expect(callbackSettled).toBe(true)
  expect(output.map((text) => JSON.parse(text))).toEqual([report])
  expect(stream.listenerCount("drain")).toBe(0)
  expect(stream.listenerCount("error")).toBe(0)

  const read = await setup()
  const readController = new AbortController()
  read.deps.signal = readController.signal
  read.deps.meetingSemantic = {
    search: async () => {
      readController.abort()
      return { items: [{ source: reference }] }
    },
    generate: vi.fn(),
  }
  expect(await run(["meetings", "semantic", "example", "--model", "installed-example", "--jsonl"], read.deps)).toBe(130)
  expect(read.output).toEqual([])
})

it("bounds cancelled embedding receipt backpressure and emits no receipt for rejected generation", async () => {
  const { deps, output } = await setup()
  const controller = new AbortController()
  deps.signal = controller.signal
  deps.meetingSemantic = {
    search: vi.fn(),
    generate: async () => {
      controller.abort()
      return { applied: true, saved: 1 }
    },
  }
  let callback: (() => void) | undefined
  const stream = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, done) {
      callback = done
    },
  })
  deps.streamData = (text, signal) => writeStream(stream, text, signal)
  expect(await run(["meetings", "embeddings", "--model", "installed-example", "--yes", "--jsonl"], deps)).toBe(130)
  expect(output).toEqual([])
  expect(stream.listenerCount("drain")).toBe(0)
  callback?.()
  expect(stream.listenerCount("error")).toBe(0)

  const failed = await setup()
  failed.deps.meetingSemantic = {
    search: vi.fn(),
    generate: async () => {
      throw new Error("invented generation failure before acknowledgement")
    },
  }
  expect(await run(["meetings", "embeddings", "--model", "installed-example", "--yes", "--jsonl"], failed.deps)).toBe(1)
  expect(failed.output).toEqual([])
})

it("opens only the selected semantic read connection and closes it before finite query output", async () => {
  const { deps, output } = await setup()
  const search = vi.fn(async () => ({ items: [], coverage: { archiveCompleteness: "unknown" } }))
  const close = vi.fn(async () => {
    expect(output).toEqual([])
  })
  const connection = { store: {} as never, accountId: 3, meetingSemantic: { search, generate: vi.fn() }, close }
  const connect = vi.fn<NonNullable<ProgramDeps["connectStore"]>>(async () => connection)
  deps.connectStore = connect
  const args = ["meetings", "semantic", "example", "--model", "installed-example", "--json"]
  expect(await run(args, deps)).toBe(3)
  expect(connect).not.toHaveBeenCalled()
  setConfig(deps.configPath, "account.profile", "example")
  expect(await run(args, deps)).toBe(0)
  expect(connect).toHaveBeenCalledWith({ profile: "example", externalId: "zm-profile:example", intent: "read" })
  expect(search).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
  expect(JSON.parse(output.pop() ?? "{}").coverage.archiveCompleteness).toBe("unknown")
  connect.mockResolvedValue({ ...connection, meetingSemantic: undefined })
  expect(await run(args, deps)).toBe(3)
  expect(close).toHaveBeenCalledTimes(2)
  expect(search).toHaveBeenCalledOnce()
  expect(output).toEqual([])
})

it("rejects unsafe remote configuration and invalid generation cursors before opening a store", async () => {
  const { deps } = await setup()
  const connect = vi.fn()
  deps.connectStore = connect
  for (const flags of [
    ["--model", " "],
    ["--model", "installed-example", "--dims", "2"],
    ["--model", "served-example", "--base-url", "invalid-url", "--dims", "2"],
    ["--model", "served-example", "--base-url", "https://example.invalid/v1?token=invented", "--dims", "2"],
    ["--model", "installed-example", "--after-hash", "invalid-hash"],
    ["--model", "installed-example", "--after-transcript-id", "0"],
  ])
    expect(await run(["meetings", "embeddings", ...flags, "--yes"], deps)).toBe(2)
  expect(connect).not.toHaveBeenCalled()
})
