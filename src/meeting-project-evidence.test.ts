import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { memoryKeyring } from "@wirecat/cli-base"
import type { MeetingSave } from "@wirecat/cli-core/meetings"
import { meetingProjectEvidenceTool } from "@wirecat/cli-core/meetings/mcp"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { openStore } from "@wirecat/cli-core/store"
import { expect, it, vi } from "vitest"
import { readJsonl } from "../scripts/testing/answers.js"
import { profileAccountKey, setConfig } from "./config.js"
import { createMeetingMcpServer } from "./mcp-server.js"
import { readProjectEvidenceTool } from "./meeting-project-evidence-mcp.js"
import { type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const fixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-project-evidence-"))
  const path = join(directory, "fixture.db")
  const env = { MESSAGING_STORE: path }
  let time = Date.parse("2026-10-14T12:00:00Z")
  const now = () => time
  const store = await openStore({ path, env, now })
  const selected = await store.saveAccount(
    { provider: "zoom", account: profileAccountKey("AliceExample") },
    { name: "Alice Example" },
  )
  const foreign = await store.saveAccount(
    { provider: "zoom", account: profileAccountKey("BobSample") },
    { name: "Bob Sample" },
  )
  const sample = sampleMeeting()
  const start = Date.parse("2026-10-10T10:00:00Z")
  const input: MeetingSave = {
    ...sample,
    meeting: { ...sample.meeting, accountId: selected, startedAt: start, endedAt: start + 3600000 },
    chat: [],
    summaries: [],
    transcripts: [
      {
        ...sample.transcripts[0],
        rows: ["исследование launch", "исследование review"].map((text, position) => ({
          ...sample.transcripts[0].rows[0],
          text,
          position,
        })),
      },
    ],
  }
  const saved = await store.meetings.saveMeeting(input)
  await store.meetings.saveMeeting({ ...input, meeting: { ...input.meeting, accountId: foreign } })
  await store.meetings.indexSearch({ accountId: selected })
  await store.meetings.indexSearch({ accountId: foreign })
  const project = await store.knowledge.addProject({ name: "Research Example", key: "RES", scope: "work" })
  await store.knowledge.addVocabularyAlias({ kind: "project", id: project.id }, "исследование")
  await store.knowledge.addVocabularyAlias({ kind: "project", id: project.id }, "Study Work")
  await store.close()
  const participant = saved.participants[0]
  if (!participant) throw Error("missing invented participant")
  const output: string[] = [],
    errors: string[] = []
  const network = vi.fn(async () => {
    throw Error("unexpected external access")
  })
  const close = vi.fn()
  const connector = createStoreConnector({ path, env, now })
  const connectStore = vi.fn<NonNullable<ProgramDeps["connectStore"]>>(async (request) => {
    const connection = await connector(request)
    return {
      ...connection,
      close: async () => {
        await connection.close()
        close()
      },
    }
  })
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({ clientId: "invented", keyring: memoryKeyring(), service: "invented", fetch: network }),
    fetch: network,
    openBrowser: network,
    now,
    connectStore,
    data: (text) => {
      expect(close.mock.calls.length).toBe(connectStore.mock.calls.length)
      output.push(text)
    },
    diagnostic: (text) => errors.push(text),
  }
  setConfig(deps.configPath, "account.profile", "AliceExample")
  const request = {
    profile: "AliceExample",
    externalId: profileAccountKey("AliceExample"),
    intent: "read" as const,
    capability: "meeting-project-evidence" as const,
  }
  return {
    deps,
    output,
    errors,
    selected,
    foreign,
    saved,
    participant,
    project,
    path,
    env,
    connectStore,
    close,
    network,
    now,
    advance: () => {
      time += 86400000
    },
    connect: () => connectStore(request),
  }
}
const validator = new AjvJsonSchemaValidator().getValidator<Record<string, unknown>>(
  meetingProjectEvidenceTool.outputSchema,
)

it("keeps empty alias pages, frozen date scope and within-name continuation in the complete CLI envelope", async () => {
  const f = await fixture()
  const query = `identity_id:${f.participant.identityId} started_at:[7d TO today]`
  const invoke = async (selection: string, cursor?: string) => {
    f.output.length = 0
    const args = [
      "--offline",
      "meetings",
      "projects",
      "evidence",
      "RES",
      selection,
      "--limit",
      "1",
      "--max-read-bytes",
      "1024",
      "--json",
    ]
    if (cursor) args.push("--cursor", cursor)
    const code = await run(args, f.deps)
    return { code, answer: f.output.length ? JSON.parse(f.output.join("")) : undefined }
  }
  const first = await invoke(query)
  expect(first.code, f.errors.join("")).toBe(0)
  expect(validator(first.answer).valid).toBe(true)
  expect(first.answer).toMatchObject({
    item: {
      hits: [],
      page: { has_more: true },
      project: { id: f.project.id, key: "RES" },
      coverage: { archive_completeness: "unknown" },
      selection: { identity_id: String(f.participant.identityId), since: "2026-10-07T12:00:00.000Z" },
    },
    meta: { run_id: expect.any(String), duration_ms: 0 },
  })
  const action = first.answer.next[0]
  expect(action.command).toBe("meetings projects evidence")
  expect(action.args).toMatchObject({ project: "RES", limit: 1, max_read_bytes: 1024 })
  expect(action.args.query).not.toContain("7d")
  f.advance()
  expect((await invoke(query, action.args.cursor)).code).toBe(2)
  expect(f.output).toEqual([])
  let cursor = action.args.cursor
  const hits: string[] = []
  let pages = 0
  while (cursor) {
    const next = await invoke(action.args.query, cursor)
    expect(next.code, f.errors.join("")).toBe(0)
    expect(validator(next.answer).valid).toBe(true)
    hits.push(...next.answer.item.hits.map((hit: { ref: string }) => hit.ref))
    expect(next.answer.item.association).toBe("unconfirmed-word-evidence")
    cursor = next.answer.item.page.next_cursor
    if (++pages > 8) throw Error("unbounded evidence pages")
  }
  expect(hits).toHaveLength(2)
  expect(hits.every((ref) => ref.startsWith(`meeting:${f.selected}/${f.saved.meeting.id}/`))).toBe(true)
  expect(f.network).not.toHaveBeenCalled()
  const store = await openStore({ path: f.path, env: f.env })
  try {
    expect(
      (await store.meetings.searchHits("исследование", { accountId: f.selected, projectId: Number(f.project.id) }))
        .items,
    ).toEqual([])
  } finally {
    await store.close()
  }
})

it("advertises MCP without IO and validates query semantics before opening its selected read connection", async () => {
  const f = await fixture()
  const server = createMeetingMcpServer({ connectStore: f.connect, now: f.now })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  const client = new Client({ name: "invented-project-reader", version: "1" })
  await client.connect(left)
  try {
    const { tools } = await client.listTools()
    const tool = tools.find((tool) => tool.name === "meeting_project_evidence")
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false })
    expect(tool?.inputSchema.properties).not.toHaveProperty("account_id")
    expect(f.connectStore).not.toHaveBeenCalled()
    for (const args of [
      { project: "RES", query: "project_id:1" },
      { project: "RES", account_id: f.foreign },
      { project: "RES", query: "identity_id:1 OR identity_id:2" },
    ]) {
      expect(await client.callTool({ name: "meeting_project_evidence", arguments: args })).toMatchObject({
        isError: true,
      })
    }
    expect(f.connectStore).not.toHaveBeenCalled()
    const result = await client.callTool({
      name: "meeting_project_evidence",
      arguments: { project: "RES", limit: 1, max_read_bytes: 1024 },
    })
    expect(result.isError).not.toBe(true)
    expect(validator(result.structuredContent as Record<string, unknown>).valid).toBe(true)
    expect(result.structuredContent).toMatchObject({
      item: { hits: [], page: { has_more: true } },
      meta: { run_id: expect.any(String), duration_ms: 0 },
    })
    expect(f.close).toHaveBeenCalledOnce()
  } finally {
    await client.close()
    await server.close()
  }
})

it("refuses malformed CLI selectors before connection and drops buffered success if cleanup fails", async () => {
  const f = await fixture()
  for (const suffix of [["identity_id:0"], ["--limit", "0"], ["project_id:1"], ["--cursor", "!"]]) {
    expect(await run(["meetings", "projects", "evidence", "RES", ...suffix, "--json"], f.deps)).toBe(2)
  }
  expect(f.output).toEqual([])
  expect(f.connectStore).not.toHaveBeenCalled()
  const connection = await f.connect()
  const failingClose = async () => {
    await connection.close()
    throw Error("invented cleanup failure")
  }
  f.deps.connectStore = async () => ({ ...connection, close: failingClose })
  expect(await run(["meetings", "projects", "evidence", "RES", "--json"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
})

it("MCP closes missing capabilities, cancellations and cleanup failures without returning success", async () => {
  const f = await fixture()
  const signal = new AbortController()
  expect(
    await readProjectEvidenceTool(
      {
        connectStore: async () => {
          const connection = await f.connect()
          return { ...connection, meetingProjectEvidence: undefined }
        },
      },
      { project: "RES" },
      signal.signal,
    ),
  ).toMatchObject({ isError: true })
  const before = f.close.mock.calls.length
  expect(
    await readProjectEvidenceTool(
      {
        connectStore: async () => {
          const connection = await f.connect()
          return {
            ...connection,
            meetingProjectEvidence: async (project, request) => {
              const result = await connection.meetingProjectEvidence?.(project, request)
              signal.abort()
              if (!result) throw Error("missing invented read")
              return result
            },
          }
        },
      },
      { project: "RES" },
      signal.signal,
    ),
  ).toMatchObject({ isError: true })
  expect(f.close.mock.calls.length).toBe(before + 1)
  expect(
    await readProjectEvidenceTool(
      {
        connectStore: async () => {
          const connection = await f.connect()
          return {
            ...connection,
            close: async () => {
              await connection.close()
              throw Error("invented cleanup failure")
            },
          }
        },
      },
      { project: "RES" },
      new AbortController().signal,
    ),
  ).toMatchObject({ isError: true })
})

it("supports an injected account-bound CLI reader and refuses an unavailable legacy connector", async () => {
  const f = await fixture()
  const unavailable = vi.fn(async () => {
    throw Error("unexpected connector fallback")
  })
  f.deps.connectStore = unavailable
  f.deps.meetingProjectEvidence = async (project, request) => {
    const connection = await f.connect()
    try {
      if (!connection.meetingProjectEvidence) throw Error("missing invented read")
      return await connection.meetingProjectEvidence(project, request)
    } finally {
      await connection.close()
    }
  }
  expect(await run(["meetings", "projects", "evidence", "RES", "--json"], f.deps)).toBe(0)
  expect(unavailable).not.toHaveBeenCalled()
  expect(validator(JSON.parse(f.output.join(""))).valid).toBe(true)
  f.output.length = 0
  f.deps.meetingProjectEvidence = undefined
  const close = vi.fn(async () => {})
  const connection = await f.connect()
  await connection.close()
  f.deps.connectStore = async () => ({ ...connection, meetingProjectEvidence: undefined, close })
  expect(await run(["meetings", "projects", "evidence", "RES", "--json"], f.deps)).toBe(3)
  expect(f.output).toEqual([])
  expect(close).toHaveBeenCalledOnce()
})

it("MCP rejects an invalid host account before reading and bounds the complete successful envelope", async () => {
  const f = await fixture()
  const read = vi.fn()
  expect(
    await readProjectEvidenceTool(
      {
        connectStore: async () => {
          const connection = await f.connect()
          return { ...connection, accountId: 0, meetingProjectEvidence: read }
        },
      },
      { project: "RES" },
      new AbortController().signal,
    ),
  ).toMatchObject({ isError: true })
  expect(read).not.toHaveBeenCalled()
  expect(f.close).toHaveBeenCalledOnce()
  const server = createMeetingMcpServer({ connectStore: f.connect, now: f.now, maxResultBytes: 256 })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  const client = new Client({ name: "invented-output-budget", version: "1" })
  await client.connect(left)
  try {
    await client.listTools()
    expect(await client.callTool({ name: "meeting_project_evidence", arguments: { project: "RES" } })).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "validation_error" } },
    })
    expect(f.close).toHaveBeenCalledTimes(2)
  } finally {
    await client.close()
    await server.close()
  }
})

it("keeps project citations and report continuation together in typed JSONL", async () => {
  const f = await fixture()
  expect(await run(["meetings", "projects", "evidence", "RES", "--limit", "1", "--jsonl"], f.deps)).toBe(0)
  const [report] = readJsonl(f.output.join(""))
  expect(report.project.key).toBe("RES")
  expect(report.coverage.archive_completeness).toBe("unknown")
  expect(report.page).toMatchObject({ mode: "cursor", limit: 1, has_more: true, next_cursor: expect.any(String) })
  expect(f.close).toHaveBeenCalledOnce()
})
