import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { memoryKeyring } from "@wirecat/cli-base"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { openStore } from "@wirecat/cli-core/store"
import { expect, it, vi } from "vitest"
import { readReceipt } from "../scripts/testing/answers.js"
import { setConfig } from "./config.js"
import { createMeetingMcpServer } from "./mcp-server.js"
import { type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const fixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-passage-"))
  const path = join(directory, "fixture.db")
  const env = { MESSAGING_STORE: path }
  const store = await openStore({ path, env, now: () => 3000 })
  try {
    const accountId = await store.saveAccount(
      { provider: "zoom", account: "zm-profile:AliceExample" },
      { name: "Alice Example" },
    )
    const input = sampleMeeting()
    input.meeting.accountId = accountId
    const first = input.transcripts[0].rows[0]
    input.transcripts[0].rows = [
      { ...first, position: 0, text: "Alice Example proposed a launch" },
      { ...first, position: 4, text: "Bob Sample agreed to review" },
      { ...first, position: 9, text: "Alice Example will follow up" },
    ]
    await store.meetings.saveMeeting(input)
    await store.meetings.indexSearch({ accountId })
    const hit = (await store.meetings.searchHits("agreed", { accountId })).items[0]
    if (!hit?.ref) throw Error("missing invented search hit")
    return { directory, path, env, reference: hit.ref }
  } finally {
    await store.close()
  }
}
const request = { profile: "AliceExample", externalId: "zm-profile:AliceExample", intent: "read" as const }
const setup = async () => {
  const f = await fixture()
  const output: string[] = []
  const connect = createStoreConnector({ path: f.path, env: f.env })
  const close = vi.fn()
  const opened = vi.fn()
  const connectStore: ProgramDeps["connectStore"] = async (request) => {
    opened()
    const connection = await connect(request)
    return {
      ...connection,
      close: async () => {
        await connection.close()
        close()
      },
    }
  }
  const network = vi.fn(async () => {
    throw Error("unexpected network")
  })
  const deps: ProgramDeps = {
    configPath: join(f.directory, "config.json"),
    tokens: new TokenManager({ clientId: "example", keyring: memoryKeyring(), service: "example", fetch: network }),
    fetch: network,
    openBrowser: network,
    connectStore,
    data: (text) => output.push(text),
    diagnostic: () => {},
  }
  setConfig(deps.configPath, "account.profile", "AliceExample")
  return { ...f, deps, output, close, opened, network, connectStore }
}
it("opens published search-hit context as Markdown or structured JSON and closes before output", async () => {
  const f = await setup()
  f.deps.data = (text) => {
    expect(f.close).toHaveBeenCalled()
    f.output.push(text)
  }
  expect(
    await run(
      ["meetings", "passage", f.reference, "--before-n", "1", "--after-n", "1", "--format", "markdown"],
      f.deps,
    ),
  ).toBe(0)
  expect(f.output.join("")).toContain("Alice Example proposed a launch")
  expect(f.output.join("")).toContain(`\`${f.reference}\``)
  expect(f.opened).toHaveBeenCalledOnce()
  expect(f.close).toHaveBeenCalledOnce()
  f.output.length = 0
  expect(
    await run(
      ["meetings", "passage", f.reference, "--before-n", "0", "--after-n", "0", "--format", "markdown", "--json"],
      f.deps,
    ),
  ).toBe(0)
  const packet = readReceipt(f.output.join(""))
  expect(packet).toMatchObject({
    kind: "meeting_context",
    target_ref: f.reference,
    coverage: { included: 1, has_before: true, has_after: true, archive_completeness: "unknown" },
  })
  expect(packet.items[0].text).toBe("Bob Sample agreed to review")
  f.output.length = 0
  expect(
    await run(["meetings", "passage", f.reference, "--expected-fingerprint", "0".repeat(64), "--json"], f.deps),
  ).not.toBe(0)
  expect(f.output).toEqual([])
  expect(await run(["meetings", "passage", f.reference, "--max-read-bytes", "1", "--json"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(await run(["meetings", "passage", f.reference, "--bytes", "2", "--json"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(await run(["meetings", "passage", f.reference, "--fields", "target_ref"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(await run(["meetings", "passage", f.reference, "--jsonl"], f.deps)).toBe(0)
  expect(readReceipt(f.output.join(""))).toMatchObject({ kind: "meeting_context", coverage: { included: 3 } })
  f.output.length = 0
  f.network.mockClear()
  f.opened.mockClear()
  expect(await run(["meetings", "passage", f.reference, "--before-n", "-1"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(f.network).not.toHaveBeenCalled()
  expect(f.opened).not.toHaveBeenCalled()
})
it("serves the same cited context through opt-in MCP and rejects account injection before connection", async () => {
  const f = await setup()
  const connect = vi.fn(async () => f.connectStore?.(request))
  const server = createMeetingMcpServer({
    includeMeetingContext: true,
    connectStore: async () => {
      const connection = await connect()
      if (!connection) throw Error("missing invented connection")
      return connection
    },
  })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  const client = new Client({ name: "example-passage-client", version: "1" })
  await client.connect(left)
  try {
    expect((await client.listTools()).tools.some((tool) => tool.name === "meeting_passage")).toBe(true)
    expect(connect).not.toHaveBeenCalled()
    expect(
      await client.callTool({ name: "meeting_passage", arguments: { reference: f.reference, account_id: 99 } }),
    ).toMatchObject({ isError: true })
    expect(connect).not.toHaveBeenCalled()
    const result = await client.callTool({
      name: "meeting_passage",
      arguments: { reference: f.reference, before: 1, after: 1, format: "markdown" },
    })
    expect(result).toMatchObject({
      structuredContent: { item: { target_ref: f.reference, coverage: { included: 3 } } },
    })
    expect(JSON.stringify(result.content)).toContain("Bob Sample agreed to review")
    expect(f.close).toHaveBeenCalledOnce()
    const foreign = f.reference.replace(/^meeting:\d+\//, "meeting:999/")
    expect(await client.callTool({ name: "meeting_passage", arguments: { reference: foreign } })).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "not_found" } },
    })
    expect(f.close).toHaveBeenCalledTimes(2)
    expect(f.network).not.toHaveBeenCalled()
  } finally {
    await client.close()
    await server.close()
  }
})
