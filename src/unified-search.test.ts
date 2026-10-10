import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-core"
import { expect, it, vi } from "vitest"
import { setConfig } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"
import { runUnifiedSearch, type UnifiedSearchRequest, validateUnifiedSearch } from "./unified-search.js"

const result = {
  query: "example",
  items: [],
  hasMore: null,
  searched: ["meetings"] as const,
  skipped: [],
  meetings: {
    accountId: 3,
    by: "word-prefixes" as const,
    meetingsScanned: 100,
    complete: false,
    nextCursor: { accountId: 3, query: "example", meetingOffset: 100, hitOffset: 0 },
  },
}
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-unified-cli-"))
  const output: string[] = []
  const errors: string[] = []
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
    diagnostic: (text) => errors.push(text),
  }
  return { deps, output, errors }
}
const found = () => ({ ...result, searched: ["meetings"] as "meetings"[] })

it("defaults to meetings and validates closed source-only cursors before the service", async () => {
  const search = vi.fn(async (_request: UnifiedSearchRequest) => found())
  expect(await runUnifiedSearch(search, { text: "example", limit: 100 })).toEqual(found())
  expect(search.mock.calls[0]?.[0]).toMatchObject({ only: ["meetings"], maxMeetings: 100 })
  for (const change of [
    { text: " " },
    { limit: 0 },
    { limit: 1001 },
    { maxMeetings: 0 },
    { only: [] },
    { only: ["unknown"] },
    { only: ["notes"] },
  ])
    expect(() =>
      validateUnifiedSearch({ text: "example", limit: 100, ...change } as UnifiedSearchRequest, true),
    ).toThrow()
  for (const cursor of [
    null,
    0,
    [],
    { ...result.meetings.nextCursor, extra: 1 },
    { ...result.meetings.nextCursor, hitOffset: -1 },
  ])
    expect(() =>
      validateUnifiedSearch({ text: "example", limit: 100, meetingCursor: cursor } as UnifiedSearchRequest),
    ).toThrow()
  expect(() =>
    validateUnifiedSearch({
      text: "example",
      limit: 100,
      only: ["notes", "meetings"],
      meetingCursor: result.meetings.nextCursor,
    }),
  ).toThrow()
})

it("preserves nullable completeness and explicit cross-resource opt-in in CLI", async () => {
  const { deps, output } = await setup()
  const search = vi.fn(async (_request: UnifiedSearchRequest) => found())
  deps.unifiedSearch = search
  expect(await run(["search", "all", "example", "--json"], deps)).toBe(0)
  expect(JSON.parse(output.pop() ?? "{}")).toEqual(found())
  expect(search.mock.calls[0]?.[0]).toMatchObject({ only: ["meetings"] })
  expect(await run(["search", "all", "example", "--only", "notes,meetings", "--json"], deps)).toBe(0)
  expect(search.mock.calls[1]?.[0]).toMatchObject({ only: ["notes", "meetings"] })
  expect(
    await run(
      ["search", "all", "example", "--meeting-cursor", JSON.stringify(result.meetings.nextCursor), "--json"],
      deps,
    ),
  ).toBe(0)
  expect(search.mock.calls[2]?.[0]).toMatchObject({ meetingCursor: result.meetings.nextCursor })
  output.length = 0
  expect(await run(["search", "all", "example", "--jsonl"], deps)).toBe(0)
  expect(output.join("").trim().split("\n")).toHaveLength(1)
  expect(JSON.parse(output.join(""))).toEqual(found())
})

it("resolves read intent only after validating query options and closes before finite output", async () => {
  const { deps, output } = await setup()
  const connect = vi.fn(async () => ({
    store: {} as never,
    accountId: 3,
    unifiedSearch: async () => found(),
    close: async () => {},
  }))
  deps.connectStore = connect
  expect(await run(["search", "all", "example", "--limit", "0", "--json"], deps)).toBe(2)
  expect(await run(["search", "all", "example", "--meeting-cursor", "not-json", "--json"], deps)).toBe(2)
  expect(connect).not.toHaveBeenCalled()
  expect(await run(["search", "all", "example", "--json"], deps)).toBe(3)
  setConfig(deps.configPath, "account.profile", "example")
  expect(await run(["search", "all", "example", "--json"], deps)).toBe(0)
  expect(connect).toHaveBeenCalledWith({ profile: "example", externalId: "zm-profile:example", intent: "read" })
  expect(output).toHaveLength(1)
  const close = vi.fn(async () => {})
  deps.connectStore = async () => ({ store: {} as never, accountId: 3, close })
  expect(await run(["search", "all", "example", "--json"], deps)).toBe(3)
  expect(close).toHaveBeenCalledOnce()
})

it("prevents service work on cancellation and rejects late cancelled results", async () => {
  const controller = new AbortController()
  const search = vi.fn(async () => {
    controller.abort()
    return found()
  })
  await expect(
    runUnifiedSearch(search, { text: "example", limit: 100, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "cancelled" })
  await expect(
    runUnifiedSearch(search, { text: "example", limit: 100, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "cancelled" })
  expect(search).toHaveBeenCalledOnce()
})
