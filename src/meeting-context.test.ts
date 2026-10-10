import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-core"
import { expect, it, vi } from "vitest"
import { setConfig } from "./config.js"
import {
  createMeetingContextCapabilities,
  validateEvidenceOptions,
  validatePersonContext,
  validateTaskKind,
  validateTaskProposal,
} from "./meeting-context.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const api = vi.hoisted(() => ({
  parseMeetingReference: vi.fn((text: string) => ({ accountId: Number(text.slice(8).split("/")[0]) })),
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
const reference = "meeting:3/15/20/0"
const evidence = {
  schemaVersion: 1,
  kind: "meeting",
  source: reference,
  fingerprint: "example-fingerprint",
  items: [],
  coverage: { archiveCompleteness: "unknown", hasMore: false, input: "materialized-meeting" },
}
const proposal = {
  id: "example-proposal",
  source: reference,
  sourceKind: "meeting",
  accountId: 3,
  kind: "promise",
  applied: false,
  persistence: "proposal-only",
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
  const full = { personByUid: vi.fn(), involvements: {} }
  const callbacks = createMeetingContextCapabilities(full, { meeting }, 3)
  expect(await callbacks.evidence?.(reference)).toEqual(evidence)
  expect(api.readMeetingEvidence).toHaveBeenCalledWith({ meeting }, 3, reference, expect.any(Object))
  const reads = api.readMeetingEvidence.mock.calls.length
  await expect(callbacks.evidence?.("meeting:99/15")).rejects.toMatchObject({ code: "not_found" })
  expect(api.readMeetingEvidence).toHaveBeenCalledTimes(reads)
  expect(meeting).not.toHaveBeenCalled()
  await callbacks.personContext?.("person:7", { accountIds: [99] } as never)
  expect(api.personMeetingContext).toHaveBeenLastCalledWith(
    full,
    "person:7",
    expect.objectContaining({ accountIds: [3] }),
  )
  expect(await callbacks.taskProposal?.(reference, "promise")).toEqual(proposal)
  expect(api.proposeMeetingTask).toHaveBeenCalledWith({ meeting }, 3, reference, "promise")
})

it("reports unavailable public capabilities without inventing fallback evidence", async () => {
  const meeting = vi.fn()
  const context = createMeetingContextCapabilities({}, { meeting }, 3, async () => ({}))
  await expect(context.evidence?.(reference)).rejects.toMatchObject({ code: "configuration_error" })
  await expect(context.personContext?.("person:7")).rejects.toMatchObject({ code: "configuration_error" })
  await expect(context.taskProposal?.(reference, "promise")).rejects.toMatchObject({ code: "configuration_error" })
  const parser = {
    parseMeetingReference: () => ({ accountId: 3 }),
    canonicalMeetingReference: (value: string) => value,
  }
  const missingService = createMeetingContextCapabilities({}, { meeting }, 3, async () => parser)
  await expect(missingService.evidence?.(reference)).rejects.toMatchObject({ code: "configuration_error" })
  await expect(missingService.taskProposal?.(reference, "promise")).rejects.toMatchObject({
    code: "configuration_error",
  })
  expect(meeting).not.toHaveBeenCalled()
})

it("validates limits, person identifiers and unapplied task kinds before context work", () => {
  for (const options of [{ cues: 0 }, { cues: 1001 }, { bytes: 1 }, { bytes: 4194305 }])
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
  expect(() => createMeetingContextCapabilities({}, { meeting: vi.fn() }, 0)).toThrow()
})

it("stops cancelled context callbacks before reads and discards late cancelled evidence", async () => {
  const controller = new AbortController()
  const read = vi.fn(async () => {
    controller.abort()
    return evidence
  })
  const parser = {
    parseMeetingReference: () => ({ accountId: 3 }),
    canonicalMeetingReference: (value: string) => value,
  }
  const context = createMeetingContextCapabilities({}, { meeting: vi.fn() }, 3, async () => ({
    ...parser,
    readMeetingEvidence: read,
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
    evidence: async () => evidence,
    personContext: async () => ({ items: [], coverage: { complete: false, pending: 2 } }),
    taskProposal: async () => proposal,
  }
  expect(await run(["meetings", "evidence", reference, "--jsonl"], deps)).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}")).toEqual(evidence)
  expect(
    await run(
      ["meetings", "context", "person:7", "--meetings", "2", "--since", "2026-10-10T00:00:00.000Z", "--json"],
      deps,
    ),
  ).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}").coverage.complete).toBe(false)
  expect(await run(["meetings", "task-proposal", reference, "--kind", "promise", "--json"], deps)).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}").applied).toBe(false)
  const serve = vi.fn(async () => {})
  deps.serveMcp = serve
  expect(await run(["serve", "--mcp", "--meeting-context"], deps)).toBe(0)
  expect(serve).toHaveBeenCalledWith(expect.objectContaining({ includeMeetingContext: true }))
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
  expect(await run(["meetings", "task-proposal", reference, "--kind", "invalid", "--json"], deps)).toBe(2)
  expect(await run(["meetings", "context", "person:7", "--since", "invalid", "--json"], deps)).toBe(2)
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
    ["task-proposal", reference, "--kind", "promise"],
  ])
    expect(await run(["meetings", ...args, "--json"], deps)).toBe(3)
  expect(output).toEqual([])
})
