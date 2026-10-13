import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { memoryMeetingStore } from "@wirecat/cli-messaging/meetings/testing"
import { expect, it, vi } from "vitest"
import { createMeetingMcpServer } from "./mcp-server.js"
import { createMeetingContextCapabilities } from "./meeting-context.js"

it("discovers opt-in context without IO, rejects account overrides, and closes before returning owned evidence", async () => {
  const read = vi.fn().mockResolvedValue({ items: [], coverage: { complete: false }, source: "meeting:3/15" })
  const proposal = vi.fn().mockResolvedValue({ applied: false, persistence: "proposal-only", source: "meeting:3/15" })
  const personStore = {
    personByUid: vi.fn(async () => undefined),
    personSeenInAccounts: vi.fn(async () => true),
    involvements: {
      rebuild: vi.fn(() => 0),
      drain: vi.fn(() => ({ recomputed: 0, pending: 0 })),
      pending: vi.fn(() => 0),
      forPerson: vi.fn(() => []),
    },
  }
  const context = createMeetingContextCapabilities(
    personStore,
    { meetingMetadata: vi.fn(), transcriptMetadata: vi.fn(), transcripts: vi.fn(), transcriptRows: vi.fn() },
    3,
    async () => ({
      parseMeetingReference: (text) => ({
        type: "meeting" as const,
        accountId: Number(text.slice(8).split("/")[0]),
        meetingId: 15,
      }),
      canonicalMeetingReference: (text) => text,
      readMeetingEvidence: read,
      personMeetingContext: read,
      proposeMeetingTask: proposal,
    }),
  )
  const close = vi.fn(async () => {})
  const connect = vi.fn(async () => ({ store: memoryMeetingStore(), accountId: 3, meetingContext: context, close }))
  const server = createMeetingMcpServer({ connectStore: connect, includeMeetingContext: true })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  const client = new Client({ name: "example-context-client", version: "1" })
  await client.connect(left)
  try {
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(10)
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
    expect(connect).not.toHaveBeenCalled()
    for (const request of [
      { name: "meeting_evidence", arguments: { reference: "meeting:3/15", account_id: 99 } },
      { name: "person_meeting_context", arguments: { person: "person:7", accountIds: [99] } },
      { name: "meeting_task_proposal", arguments: { reference: "meeting:3/15", kind: "invalid" } },
      { name: "meeting_evidence", arguments: { reference: "meeting:3/15", cues: 0 } },
    ])
      expect(await client.callTool(request)).toMatchObject({ isError: true })
    expect(connect).not.toHaveBeenCalled()
    expect(
      await client.callTool({ name: "meeting_evidence", arguments: { reference: "meeting:99/15" } }),
    ).toMatchObject({ isError: true, structuredContent: { error: { code: "not_found" } } })
    expect(read).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(await client.callTool({ name: "meeting_evidence", arguments: { reference: "meeting:3/15" } })).toMatchObject(
      { structuredContent: { source: "meeting:3/15", coverage: { complete: false } } },
    )
    expect(close).toHaveBeenCalledTimes(2)
    expect(await client.callTool({ name: "person_meeting_context", arguments: { person: "person:7" } })).toMatchObject({
      structuredContent: { coverage: { complete: false } },
    })
    expect(read).toHaveBeenLastCalledWith(
      expect.objectContaining({ involvements: personStore.involvements }),
      "person:7",
      expect.objectContaining({ accountIds: [3] }),
    )
    expect(
      await client.callTool({
        name: "meeting_task_proposal",
        arguments: { reference: "meeting:3/15", kind: "promise" },
      }),
    ).toMatchObject({ structuredContent: { applied: false, persistence: "proposal-only" } })
    expect(close).toHaveBeenCalledTimes(4)
  } finally {
    await client.close()
    await server.close()
  }
})

it("exposes semantic queries only with a server-selected model and never exposes vector generation", async () => {
  const report = { items: [], ranking: "scanned-candidates", complete: false, hasMore: true, nextChunkId: 12 }
  const search = vi.fn(async () => report)
  const generate = vi.fn()
  const close = vi.fn(async () => {})
  const connect = vi.fn(async () => ({
    store: memoryMeetingStore(),
    accountId: 3,
    meetingSemantic: { search, generate },
    close,
  }))
  const selectedModel = { model: "installed-example" }
  const server = createMeetingMcpServer({ connectStore: connect, semanticModel: selectedModel })
  selectedModel.model = "changed-example"
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  const client = new Client({ name: "example-semantic-client", version: "1" })
  await client.connect(left)
  try {
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(7)
    expect(tools.find((tool) => tool.name === "search_meetings")?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((tool) => tool.name === "search_meetings")?.inputSchema.properties).toHaveProperty("by_meaning")
    expect(tools.some((tool) => tool.name.includes("generate"))).toBe(false)
    expect(connect).not.toHaveBeenCalled()
    for (const arguments_ of [
      { query: "example", model: "foreign-model" },
      { query: "example", account_id: 99 },
      { query: "example", yes: true },
      { query: "example", by_meaning: true, max_chunks: 10001 },
      { query: "example", by_meaning: true, cursor: "abc" },
      { query: "example", by_meaning: true, event_id: 1 },
    ])
      expect(await client.callTool({ name: "search_meetings", arguments: arguments_ })).toMatchObject({
        isError: true,
      })
    expect(
      await client.callTool({
        name: "search_meetings",
        arguments: { query: "example", by_meaning: true, cursor: "4" },
      }),
    ).toMatchObject({ structuredContent: { ...report, nextCursor: "12" } })
    expect(search).toHaveBeenCalledWith("example", expect.not.objectContaining({ buildMissing: true }))
    expect(search).toHaveBeenCalledWith(
      "example",
      expect.objectContaining({ model: "installed-example", afterChunkId: 4 }),
    )
    expect(generate).not.toHaveBeenCalled()
  } finally {
    await client.close()
    await server.close()
  }
})
