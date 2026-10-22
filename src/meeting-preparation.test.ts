import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { expect, it, vi } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { preparationFixture as fixture, now } from "../scripts/testing/preparation.js"
import { createMeetingMcpServer } from "./mcp-server.js"
import { createZoomPreparationReader } from "./meeting-preparation.js"
import { readPreparationTool } from "./meeting-preparation-mcp.js"
import { run } from "./program.js"

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
  expect(item.related).toMatchObject({
    anchors: [f.reference],
    has_more: false,
    items: [
      {
        ref: f.relatedReference,
        shared_person: true,
        shared_project: true,
        evidence: { items: [{ text: "Ship the example plan." }] },
      },
    ],
  })
  expect(item.related.items).toHaveLength(1)
  expect(item.knowledge).toMatchObject({
    anchors: [f.reference],
    items: [{ ref: f.projectFact.ref, statement: "Use the written launch checklist", shared_project: true }],
    coverage: { fact_evidence: "not-revalidated", other_sources: "not-queried", has_more: false },
  })
  expect(item.knowledge.items).toHaveLength(1)
  expect(item.notes).toMatchObject({
    anchors: [f.reference],
    items: [{ ref: f.projectNote.ref, text: f.projectNote.text, revision: 2 }],
    coverage: {
      has_more: false,
      output_limited: false,
      source_evidence: "not-revalidated",
      other_sources: "not-queried",
    },
  })
  expect(item.notes.items).toHaveLength(1)
  expect(f.connectStore).toHaveBeenCalledOnce()
  expect(f.connectStore).toHaveBeenCalledWith(expect.objectContaining({ intent: "preparation" }))
  expect(f.network).toHaveBeenCalledOnce()
  expect(f.errors).toEqual([])
  expect(f.output.join("")).not.toContain("invented-access")
})

it("CLI and MCP include direct meeting notes without importing notes from other meetings", async () => {
  const f = await fixture(undefined, true)
  expect(await run(["meetings", "prepare", "123", "--json"], f.deps)).toBe(0)
  const notes = readAnswer(f.output.join("")).notes
  expect(notes.selection).toBe("owner-written-meeting/person/project-notes")
  expect(notes.items).toEqual([
    expect.objectContaining({ ref: f.meetingNote?.ref, meeting: f.reference, person: null, project: null }),
    expect.objectContaining({ ref: f.projectNote.ref, meeting: null, project: expect.any(String) }),
  ])
  const result = await readPreparationTool(f.mcp, { series_id: "123" }, new AbortController().signal)
  expect("isError" in result && result.isError).not.toBe(true)
  expect(result.structuredContent).toMatchObject({ item: { notes } })
})

it("refuses invalid fields, provider IDs and offline reads before store or credentials", async () => {
  const f = await fixture()
  const load = vi.spyOn(f.tokens.options.keyring, "get")
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

it("raw MCP refuses communications without a captured grant before protected reads", async () => {
  const f = await fixture()
  const load = vi.spyOn(f.tokens.options.keyring, "get")
  const result = await readPreparationTool(
    f.mcp,
    { series_id: "123", communications: { sources: [{ id: "unconfigured" }], query: "launch" } },
    new AbortController().signal,
  )
  expect(result).toMatchObject({ isError: true })
  expect(JSON.stringify(result)).toContain("validation_error")
  expect(JSON.stringify(result)).toContain("communications")
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
})

it("refuses unconfigured communications before store access or credentials, without output", async () => {
  const f = await fixture()
  const load = vi.spyOn(f.tokens.options.keyring, "get")
  for (const option of [
    [],
    ["--context-since-time", "2026-10-01T00:00:00Z"],
    ["--context-before-time", "2026-10-10T00:00:00Z"],
  ]) {
    f.errors.length = 0
    expect(
      await run(
        ["meetings", "prepare", "123", "--context-source", "chat-1", "--context-query", "plan", ...option, "--json"],
        f.deps,
      ),
    ).not.toBe(0)
    expect(f.errors.join("")).toContain("configure context.sources")
  }
  expect(f.output).toEqual([])
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it("fact-reference projection retains knowledge pagination and coverage", async () => {
  const f = await fixture()
  expect(await run(["meetings", "prepare", "123", "--json=knowledge.items.ref"], f.deps)).toBe(0)
  const item = readAnswer(f.output.join(""))
  expect(item.knowledge).toMatchObject({
    items: [{ ref: f.projectFact.ref }],
    coverage: {
      has_more: false,
      output_limited: false,
      fact_evidence: "not-revalidated",
      other_sources: "not-queried",
    },
  })
  expect(item.knowledge.items[0]).toEqual({ ref: f.projectFact.ref })
  expect(item.coverage).toMatchObject({ archive_completeness: "unknown", fact_evidence: "not-revalidated" })
})

it("note-reference projection retains note source and pagination coverage", async () => {
  const f = await fixture()
  expect(await run(["meetings", "prepare", "123", "--json=notes.items.ref"], f.deps)).toBe(0)
  const item = readAnswer(f.output.join(""))
  expect(item.notes).toMatchObject({
    items: [{ ref: f.projectNote.ref }],
    coverage: {
      has_more: false,
      output_limited: false,
      source_evidence: "not-revalidated",
      other_sources: "not-queried",
    },
  })
  expect(item.notes.items[0]).toEqual({ ref: f.projectNote.ref })
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
          related: { items: [{ ref: f.relatedReference, shared_person: true, shared_project: true }] },
          knowledge: { items: [{ ref: f.projectFact.ref, shared_project: true }] },
          notes: { items: [{ ref: f.projectNote.ref, revision: 2, text: f.projectNote.text }] },
        })
        expect(f.closed).toHaveBeenCalledOnce()
      }
    } finally {
      await client.close()
      await server.close()
    }
  }
})

it("keeps the native MCP preparation item within bytes after hidden text expands", async () => {
  const f = await fixture("\u200b".repeat(11000))
  expect(Buffer.byteLength(f.projectNote.text)).toBe(33000)
  expect(await run(["meetings", "prepare", "123", "--bytes", "65536", "--json"], f.deps)).toBe(0)
  const raw = readAnswer(f.output.join(""))
  expect(raw.notes.items[0]).toMatchObject({ ref: f.projectNote.ref, text: f.projectNote.text })
  expect(Buffer.byteLength(JSON.stringify(raw))).toBeLessThanOrEqual(65536)
  const result = await readPreparationTool(f.mcp, { series_id: "123", bytes: 65536 }, new AbortController().signal)
  expect(result).not.toMatchObject({ isError: true })
  expect(result).toMatchObject({
    structuredContent: {
      meta: { truncated: true },
      item: {
        notes: { items: [], coverage: { output_limited: true } },
        meetings: [{ ref: f.reference }],
        knowledge: { items: [{ ref: f.projectFact.ref }] },
      },
    },
  })
  const item = readAnswer(JSON.stringify(result.structuredContent))
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(65536)
  expect(f.closed).toHaveBeenCalledTimes(2)
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
  const prepared = readAnswer(f.output.join(""))
  expect(prepared).toMatchObject({
    limits: { meetings: 1, cues: 1, context_limit: 1, max_read_bytes: 4096, bytes: 8192 },
    history_window: { after: "2026-09-20T00:00:00.000Z" },
  })
  f.output.length = 0
  expect(await run([...flags, "--json=kind,account_id"], f.deps)).toBe(0)
  expect(readAnswer(f.output.join(""))).toEqual({
    kind: "meeting_preparation",
    account_id: String(f.accountId),
    coverage: prepared.coverage,
  })
})

it("the public reader validates before credentials and closes on cancellation during binding", async () => {
  const f = await fixture()
  const credentials = vi.fn(() => f.tokens)
  const connect = vi.fn(() => f.mcp.connectStore())
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

it("refuses absent profile bindings and foreign providers without dispatching", async () => {
  const f = await fixture()
  for (const binding of [undefined, { scope: { provider: "other", account: "example" }, create: vi.fn() }]) {
    const close = vi.fn(async () => {})
    const reader = createZoomPreparationReader({
      credentials: () => f.tokens,
      fetch: f.network,
      connect: async () => ({ meetingPreparation: binding, close }),
    })
    await expect(reader("123", { after: now, until: now + 1000, historyAfter: now - 1000 })).rejects.toMatchObject({
      code: "configuration_error",
    })
    expect(close).toHaveBeenCalledOnce()
  }
  const missing = await readPreparationTool(
    { ...f.mcp, preparation: undefined },
    { series_id: "123" },
    new AbortController().signal,
  )
  expect(missing).toMatchObject({ isError: true })
  expect(JSON.stringify(missing)).toContain("configuration_error")
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
})

it("requires a stored profile and refuses MCP output modes and offline remote embeddings", async () => {
  const f = await fixture()
  const serveMcp = vi.fn(async () => {})
  expect(await run(["meetings", "prepare", "123", "--json"], { ...f.deps, connectStore: undefined })).not.toBe(0)
  expect(await run(["serve", "--mcp", "--json=id"], { ...f.deps, serveMcp })).toBe(2)
  expect(
    await run(
      [
        "serve",
        "--mcp",
        "--semantic",
        "--model",
        "example",
        "--base-url",
        "http://localhost:1234",
        "--dims",
        "3",
        "--offline",
      ],
      { ...f.deps, serveMcp },
    ),
  ).not.toBe(0)
  expect(serveMcp).not.toHaveBeenCalled()
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
})
