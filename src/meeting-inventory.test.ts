import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { expect, it, vi } from "vitest"
import { readAnswer, readJsonl } from "../scripts/testing/answers.js"
import { useProfile } from "../scripts/testing/profile.js"
import { setConfig } from "./config.js"
import { createZoomInventoryReader } from "./meeting-inventory.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const now = Date.parse("2026-10-18T00:00:00Z")
const window = { after: now, until: now + 7 * 86400000 }
const body = {
  meetings: [{ id: 123, topic: "Harbour Example", type: 8, start_time: "2026-10-01T10:00:00Z" }],
  next_page_token: "later-example",
}
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-inventory-"))
  const output: string[] = [],
    errors: string[] = []
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)))
  const tokens = new TokenManager({
    clientId: "invented-client",
    keyring: memoryKeyring(),
    service: "invented-inventory",
    fetch: fetcher,
    now: () => now,
  })
  const alice = tokens.forProfile("AliceExample", null)
  alice.save({
    accessToken: "invented-access",
    refreshToken: "invented-refresh",
    expiresAt: now + 3600000,
    scopes: ["meeting:read:list_meetings"],
  })
  const connectStore = vi.fn(async (): Promise<never> => {
    throw Error("inventory must not open the store")
  })
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens,
    fetch: fetcher,
    openBrowser: async () => {
      throw Error("unexpected browser")
    },
    connectStore,
    now: () => now,
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
  }
  useProfile(deps.configPath, "AliceExample")
  setConfig(deps.configPath, "zoom.client_id", "invented-client")
  return { deps, fetcher, tokens, connectStore, output, errors }
}

it("CLI reads one bounded page and replays the absolute continuation without a store", async () => {
  const f = fixture()
  expect(
    await run(
      [
        "meetings",
        "scheduled",
        "--limit",
        "1",
        "--bytes",
        "4096",
        "--max-read-bytes",
        "65536",
        "--since-time",
        "2026-10-18T00:00:00Z",
        "--before-time",
        "2026-10-25T00:00:00Z",
        "--json",
      ],
      f.deps,
    ),
  ).toBe(0)
  const first = readAnswer(f.output.join(""))
  expect(first).toMatchObject({
    scope: { provider: "zoom", account: "zm-profile:AliceExample" },
    items: [{ meeting_id: "123", kind: "recurring" }],
    coverage: { date_hints_outside_window: 1, occurrence_proof: "not-read", calendar_completeness: "unknown" },
  })
  expect(f.fetcher).toHaveBeenCalledOnce()
  f.output.length = 0
  f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ meetings: [], next_page_token: "" })))
  expect(
    await run(
      [
        "meetings",
        "scheduled",
        "--since-time",
        first.after,
        "--before-time",
        first.until,
        "--cursor",
        first.page.next_cursor,
        "--jsonl",
      ],
      f.deps,
    ),
  ).toBe(0)
  expect(readJsonl(f.output.join(""))[0]).toMatchObject({ items: [], page: { has_more: false } })
  expect(f.connectStore).not.toHaveBeenCalled()
})

it("validates windows and offline intent before opening credentials or a store", async () => {
  const f = fixture()
  const credentials = vi.spyOn(f.tokens.options.keyring, "get")
  for (const args of [
    ["--offline", "meetings", "scheduled", "--json"],
    ["meetings", "scheduled", "--limit", "101", "--json"],
    ["meetings", "scheduled", "--since-time", "2026-02-30T00:00:00Z", "--json"],
  ])
    expect(await run(args, f.deps)).not.toBe(0)
  expect(await run(["meetings", "scheduled", "--cursor", "wrong", "--json"], f.deps)).not.toBe(0)
  expect(f.errors.at(-1)).toContain("cursor")
  expect(credentials).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled()
  expect(f.connectStore).not.toHaveBeenCalled()
})

it("captures scope once while leaving credentials cold during initialization", async () => {
  const f = fixture()
  const credentials = vi.fn((_signal?: AbortSignal) => ({
    tokens: vi.fn(async () => ({
      accessToken: "invented-access",
      refreshToken: "invented-refresh",
      expiresAt: now + 3600000,
      scopes: ["meeting:read:list_meetings"],
    })),
  }))
  const binding = { account: "zm-profile:AliceExample", credentials: { withSignal: credentials }, fetch: f.fetcher }
  const capture = vi.fn(() => binding)
  const reader = createZoomInventoryReader(capture)
  reader.capture()
  binding.account = "zm-profile:BobExample"
  expect(credentials).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled()
  expect((await reader.read(window)).scope.account).toBe("zm-profile:AliceExample")
  expect(capture).toHaveBeenCalledOnce()
})

it("aborted inventory does not capture scope or touch credentials", async () => {
  const capture = vi.fn(() => {
    throw Error("unexpected capture")
  })
  const inventory = createZoomInventoryReader(capture)
  const controller = new AbortController()
  controller.abort(new Error("invented cancellation"))
  await expect(inventory.read({ ...window, signal: controller.signal })).rejects.toThrow("invented cancellation")
  expect(capture).not.toHaveBeenCalled()
})
