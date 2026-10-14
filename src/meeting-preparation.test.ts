import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { memoryKeyring } from "@wirecat/cli-base"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { createTaskFromMeeting } from "@wirecat/cli-core/services"
import { openStore } from "@wirecat/cli-core/store"
import { expect, it, vi } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { profileAccountKey, setConfig } from "./config.js"
import { createMeetingMcpServer } from "./mcp-server.js"
import { createZoomPreparationReader } from "./meeting-preparation.js"
import { readPreparationTool } from "./meeting-preparation-mcp.js"
import { type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const now = Date.parse("2026-10-14T12:00:00Z")
const fixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-preparation-"))
  const path = join(directory, "fixture.db")
  const env = { MESSAGING_STORE: path }
  const store = await openStore({ path, env, now: () => now })
  const key = { provider: "zoom", account: profileAccountKey("AliceExample") }
  const accountId = await store.saveAccount(key, { name: "Alice Example" })
  const otherId = await store.saveAccount({ ...key, account: profileAccountKey("BobSample") }, { name: "Bob Sample" })
  const sample = sampleMeeting()
  const series = sample.meeting.series
  if (!series) throw new Error("Missing invented series")
  const input = {
    ...sample,
    meeting: {
      ...sample.meeting,
      accountId,
      startedAt: now - 86400000,
      endedAt: now - 86400000 + 1000,
      series: { ...series, externalId: "123" },
    },
  }
  const saved = await store.meetings.saveMeeting(input)
  await store.meetings.saveMeeting({ ...input, meeting: { ...input.meeting, accountId: otherId } })
  const reference = `meeting:${accountId}/${saved.meeting.id}`
  const project = await store.knowledge.addProject({ name: "Harbour Example", key: "HAR" })
  await store.knowledge.linkMeetingProject(key, String(saved.meeting.id), project.id)
  await store.facts.add({ type: "decision", statement: "Ship the invented draft", subject: reference, by: "owner" })
  await createTaskFromMeeting(store, key, { source: reference, kind: "promise", origin: "owner" })
  await store.close()
  const network = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", duration: 30 })),
  )
  const tokens = new TokenManager({
    clientId: "invented-client",
    keyring: memoryKeyring(),
    service: "invented",
    fetch: network,
    now: () => now,
  })
  tokens.save({
    accessToken: "invented-access",
    refreshToken: "invented-refresh",
    expiresAt: now + 3600000,
    scopes: ["meeting:read:meeting"],
  })
  const connector = createStoreConnector({ path, env, now: () => now })
  const closed = vi.fn()
  const connectStore = vi.fn<NonNullable<ProgramDeps["connectStore"]>>(async (request) => {
    const connection = await connector(request)
    return {
      ...connection,
      close: async () => {
        await connection.close()
        closed()
      },
    }
  })
  const output: string[] = [],
    errors: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens,
    fetch: network,
    now: () => now,
    connectStore,
    openBrowser: vi.fn(),
    data: (text) => {
      expect(closed).toHaveBeenCalledTimes(connectStore.mock.calls.length)
      output.push(text)
    },
    diagnostic: (text) => errors.push(text),
  }
  setConfig(deps.configPath, "account.profile", "AliceExample")
  setConfig(deps.configPath, "zoom.clientId", "invented-client")
  return {
    deps,
    output,
    errors,
    network,
    tokens,
    connectStore,
    closed,
    accountId,
    reference,
    mcp: {
      now: () => now,
      connectStore: () => connectStore({ profile: "AliceExample", externalId: key.account, intent: "read" }),
      preparation: { credentials: () => tokens, fetch: network },
    },
  }
}

it("CLI prepares the selected series with cited local context and closes before output", async () => {
  const f = await fixture()
  expect(await run(["meetings", "prepare", "123", "--json"], f.deps)).toBe(0)
  const item = readAnswer(f.output.join(""))
  expect(item).toMatchObject({
    kind: "meeting_preparation",
    account_id: String(f.accountId),
    upcoming: { verified_next: true, candidate: { start_at: "2026-10-15T10:00:00.000Z" } },
    meetings: [
      {
        ref: f.reference,
        evidence: { items: [{ text: "Ship the example plan." }] },
        context: {
          projects: { items: [{ key: "HAR" }] },
          facts: { items: [{ statement: "Ship the invented draft" }] },
          tasks: { items: [{ source: f.reference }] },
        },
      },
    ],
  })
  expect(item.meetings).toHaveLength(1)
  expect(f.connectStore).toHaveBeenCalledOnce()
  expect(f.connectStore).toHaveBeenCalledWith(
    expect.objectContaining({ capability: "meeting-preparation", intent: "read" }),
  )
  expect(f.network).toHaveBeenCalledOnce()
  expect(f.errors).toEqual([])
  expect(f.output.join("")).not.toContain("invented-access")
})

it("refuses invalid fields, provider IDs and offline reads before store or credentials", async () => {
  const f = await fixture()
  const load = vi.spyOn(f.tokens, "load")
  for (const command of [
    ["meetings", "prepare", "../123"],
    ["meetings", "prepare", "123", "--cues", "101"],
    ["meetings", "prepare", "123", "--since-time", "2026-02-30T00:00:00Z"],
    ["meetings", "prepare", "123", "--offline"],
  ])
    expect(await run([...command, "--json"], f.deps)).not.toBe(0)
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
  expect(f.output).toEqual([])
})

it("MCP preparation is opt-in, uses the same selected account and has strict arguments", async () => {
  const f = await fixture()
  for (const enabled of [false, true]) {
    const server = createMeetingMcpServer({ ...f.mcp, preparation: enabled ? f.mcp.preparation : undefined })
    const client = new Client({ name: "invented-preparation-agent", version: "1" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      expect((await client.listTools()).tools.some((tool) => tool.name === "meeting_prepare")).toBe(enabled)
      if (enabled) {
        const bad = await client.callTool({ name: "meeting_prepare", arguments: { series_id: "123", account_id: 999 } })
        expect(bad.isError).toBe(true)
        expect(JSON.stringify(bad)).toContain("account_id")
        expect(f.connectStore).not.toHaveBeenCalled()
        const result = await client.callTool({ name: "meeting_prepare", arguments: { series_id: "123" } })
        expect(result.isError).not.toBe(true)
        const text = result.content as { type: string; text: string }[]
        expect(readAnswer(text[0]?.text ?? "")).toMatchObject({
          account_id: String(f.accountId),
          meetings: [{ ref: f.reference }],
        })
        expect(f.closed).toHaveBeenCalledOnce()
      }
    } finally {
      await client.close()
      await server.close()
    }
  }
})

it("closes on provider failure and refuses output when close fails", async () => {
  const f = await fixture()
  f.network.mockResolvedValueOnce(new Response(JSON.stringify({ code: 4700 }), { status: 403 }))
  const signal = new AbortController().signal
  const failed = await readPreparationTool(f.mcp, { series_id: "123" }, signal)
  expect(failed).toMatchObject({ isError: true })
  expect(f.closed).toHaveBeenCalledOnce()
  const closedFailure = await readPreparationTool(
    {
      ...f.mcp,
      connectStore: async () => {
        const connection = await f.mcp.connectStore()
        return {
          ...connection,
          close: async () => {
            await connection.close()
            throw new Error("Invented close failure")
          },
        }
      },
    },
    { series_id: "123" },
    signal,
  )
  expect(closedFailure).toMatchObject({ isError: true })
  expect(JSON.stringify(closedFailure)).not.toContain("Invented close failure")
  expect(f.closed).toHaveBeenCalledTimes(2)
})

it("serve enables remote preparation explicitly and rejects it offline", async () => {
  const f = await fixture()
  const serveMcp = vi.fn(async () => {})
  expect(await run(["serve", "--mcp", "--meeting-preparation"], { ...f.deps, serveMcp })).toBe(0)
  expect(serveMcp).toHaveBeenCalledWith(
    expect.objectContaining({ preparation: expect.objectContaining({ credentials: expect.any(Function) }) }),
  )
  expect(await run(["serve", "--mcp", "--meeting-preparation", "--offline"], { ...f.deps, serveMcp })).not.toBe(0)
  expect(serveMcp).toHaveBeenCalledOnce()
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
})

it("accepts fixed windows and bounded context options, including standard field projection", async () => {
  const f = await fixture()
  const flags = [
    "meetings",
    "prepare",
    "123",
    "--since-time",
    "2026-10-14T12:00:00Z",
    "--before-time",
    "2026-10-16T12:00:00Z",
    "--history-since-time",
    "2026-09-20T00:00:00Z",
    "--meetings",
    "1",
    "--cues",
    "1",
    "--context-limit",
    "1",
    "--max-read-bytes",
    "4096",
    "--bytes",
    "8192",
  ]
  expect(await run([...flags, "--json"], f.deps)).toBe(0)
  expect(readAnswer(f.output.join(""))).toMatchObject({
    limits: { meetings: 1, cues: 1, context_limit: 1, max_read_bytes: 4096, bytes: 8192 },
    history_window: { after: "2026-09-20T00:00:00.000Z" },
  })
  f.output.length = 0
  expect(await run([...flags, "--json=kind,account_id"], f.deps)).toBe(0)
  expect(readAnswer(f.output.join(""))).toEqual({ kind: "meeting_preparation", account_id: String(f.accountId) })
})

it("the public reader validates before credentials and closes on cancellation during binding", async () => {
  const f = await fixture()
  const credentials = vi.fn(() => f.tokens)
  const connect = vi.fn(f.mcp.connectStore)
  const reader = createZoomPreparationReader({ credentials, fetch: f.network, connect })
  await expect(
    reader("123", { after: now, until: now + 1000, historyAfter: now - 1000, cues: 101 }),
  ).rejects.toMatchObject({ code: "validation_error" })
  expect(credentials).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
  const controller = new AbortController()
  const close = vi.fn(async () => {})
  const read = vi.fn()
  const cancelled = createZoomPreparationReader({
    credentials,
    fetch: f.network,
    connect: async () => ({
      close,
      meetingPreparation: {
        scope: { provider: "zoom", account: "example" },
        create: async () => {
          controller.abort()
          return read
        },
      },
    }),
  })
  await expect(
    cancelled("123", { after: now, until: now + 1000, historyAfter: now - 1000, signal: controller.signal }),
  ).rejects.toMatchObject({ code: "cancelled" })
  expect(close).toHaveBeenCalledOnce()
  expect(read).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
})
