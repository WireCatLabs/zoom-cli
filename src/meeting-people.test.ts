import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { memoryKeyring } from "@wirecat/cli-base"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { openStore } from "@wirecat/cli-core/store"
import { expect, it, vi } from "vitest"
import { readAnswer, readJsonl } from "../scripts/testing/answers.js"
import { setConfig } from "./config.js"
import { createMeetingMcpServer } from "./mcp-server.js"
import { type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const fixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-people-"))
  const path = join(directory, "fixture.db")
  const env = { MESSAGING_STORE: path }
  const store = await openStore({ path, env, now: () => 3000 })
  try {
    const selected = await store.accounts.saveAccount(
      { provider: "zoom", account: "zm-profile:AliceExample" },
      { name: "Alice Example" },
    )
    const foreign = await store.accounts.saveAccount(
      { provider: "zoom", account: "zm-profile:BobSample" },
      { name: "Bob Sample" },
    )
    for (const [index, name, accountId] of [
      [0, "Bob Sample", selected],
      [1, "Алиса Пример", selected],
      [2, "АЛИСА ПРИМЕР", selected],
      [3, "Алиса Пример", foreign],
    ] as const) {
      const input = sampleMeeting()
      input.meeting.accountId = accountId
      input.meeting.externalId = `invented-${index}`
      input.participants[0].displayName = name
      input.participants[0].email = null
      input.participants[0].identity.externalId = `invented-guest-${index}`
      await store.meetings.saveMeeting(input)
    }
    const output: string[] = []
    const network = vi.fn(async () => {
      throw Error("unexpected network")
    })
    const close = vi.fn()
    const connect = createStoreConnector({ path, env })
    const connectStore: NonNullable<ProgramDeps["connectStore"]> = async (request) => {
      const connection = await connect(request)
      return {
        ...connection,
        close: async () => {
          await connection.close()
          close()
        },
      }
    }
    const deps: ProgramDeps = {
      configPath: join(directory, "config.json"),
      tokens: new TokenManager({ clientId: "example", keyring: memoryKeyring(), service: "example", fetch: network }),
      fetch: network,
      openBrowser: network,
      connectStore,
      data: (text) => {
        expect(close).toHaveBeenCalled()
        output.push(text)
      },
      diagnostic: () => {},
    }
    setConfig(deps.configPath, "account.profile", "AliceExample")
    return { deps, output, close, network, connectStore, selected }
  } finally {
    await store.close()
  }
}

it("preserves empty participant scan pages and continuation budgets through CLI JSON", async () => {
  const f = await fixture()
  const args = [
    "--offline",
    "meetings",
    "people",
    "алиса",
    "--limit",
    "1",
    "--scan-limit",
    "1",
    "--max-read-bytes",
    "100",
    "--json",
  ]
  expect(await run(args, f.deps)).toBe(0)
  const first = readAnswer(f.output.join(""))
  expect(first).toMatchObject({
    items: [],
    page: { limit: 1, has_more: true, next_cursor: expect.any(String) },
    coverage: { scanned: 1, truncated_by: "scan_limit", archive_completeness: "unknown" },
  })
  expect(first.next[0]).toMatchObject({
    step: "page.next",
    args: { query: "алиса", limit: 1, scan_limit: 1, max_read_bytes: 100, cursor: first.page.next_cursor },
  })
  f.output.length = 0
  expect(await run([...args, "--cursor", first.page.next_cursor], f.deps)).toBe(0)
  const second = readAnswer(f.output.join(""))
  expect(second.items).toMatchObject([{ display_name: "Алиса Пример", identity_id: expect.any(Number) }])
  expect(second.page.has_more).toBe(true)
  f.output.length = 0
  expect(await run([...args, "--cursor", second.page.next_cursor], f.deps)).toBe(0)
  const last = readAnswer(f.output.join(""))
  expect(last.items).toMatchObject([{ display_name: "АЛИСА ПРИМЕР" }])
  expect(last.page).toEqual({ mode: "cursor", limit: 1, has_more: false })
  expect(last).not.toHaveProperty("next")
  expect(f.close).toHaveBeenCalledTimes(3)
  expect(f.network).not.toHaveBeenCalled()
})

it("keeps MCP participant discovery account-bound and closes each paged read", async () => {
  const f = await fixture()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMeetingMcpServer({
    version: "example",
    connectStore: () =>
      f.connectStore({ profile: "AliceExample", externalId: "zm-profile:AliceExample", intent: "read" }),
  })
  const client = new Client({ name: "invented-people-client", version: "1" })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const result = await client.callTool({
      name: "meeting_people",
      arguments: { query: "АЛИСА", limit: 1, scan_limit: 3, max_read_bytes: 100 },
    })
    expect(result).toMatchObject({
      structuredContent: {
        item: {
          account_id: f.selected,
          page: { has_more: true, next_cursor: expect.any(String) },
          items: [{ display_name: "Алиса Пример" }],
        },
      },
    })
    expect(f.close).toHaveBeenCalledOnce()
    expect(
      await client.callTool({ name: "meeting_people", arguments: { query: "алиса", account_id: 999 } }),
    ).toMatchObject({ isError: true })
    expect(f.close).toHaveBeenCalledOnce()
    expect(f.network).not.toHaveBeenCalled()
  } finally {
    await client.close()
    await server.close()
  }
})

it("keeps the bounded participant report in JSONL data with a final end record", async () => {
  const f = await fixture()
  expect(await run(["meetings", "people", "алиса", "--limit", "1", "--scan-limit", "1", "--jsonl"], f.deps)).toBe(0)
  const [report] = readJsonl(f.output.join(""))
  expect(report).toMatchObject({ items: [], page: { mode: "cursor", has_more: true, next_cursor: expect.any(String) } })
  expect(f.close).toHaveBeenCalledOnce()
})
