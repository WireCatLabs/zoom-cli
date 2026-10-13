import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { memoryMeetingStore } from "@wirecat/cli-messaging/meetings/testing"
import { expect, it, vi } from "vitest"
import { createMeetingMcpServer } from "./mcp-server.js"

it("uses the shared bounded search tool, denies account overrides and closes its connection", async () => {
  const search = vi.fn(async () => ({
    items: [],
    hasMore: false,
    nextCursor: null,
    coverage: {
      archiveCompleteness: "unknown" as const,
      currentRevisions: true as const,
      indexing: "ready" as const,
      indexCompleteness: "unknown" as const,
    },
  }))
  const close = vi.fn(async () => {})
  const connectStore = vi.fn(async () => ({ store: memoryMeetingStore(), accountId: 3, meetingSearch: search, close }))
  const server = createMeetingMcpServer({ connectStore })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "example-hit-client", version: "1" })
  await client.connect(clientTransport)
  try {
    expect((await client.listTools()).tools.some((tool) => tool.name === "search_meetings")).toBe(true)
    expect(connectStore).not.toHaveBeenCalled()
    const result = await client.callTool({
      name: "search_meetings",
      arguments: {
        query: "budget",
        identity_id: 12,
        person_id: 34,
        project: "RES",
        topic: "costs",
        event_id: 5,
        series_id: 6,
        since_time: 1000,
        until_time: 2000,
      },
    })
    expect(result.isError).not.toBe(true)
    expect(search).toHaveBeenCalledWith(
      "budget",
      expect.objectContaining({
        participantIdentityId: 12,
        personId: 34,
        project: "RES",
        topic: "costs",
        eventId: 5,
        meetingSeriesId: 6,
        since: 1000,
        until: 2000,
      }),
    )
    expect(close).toHaveBeenCalledOnce()
    const rejected = await client.callTool({
      name: "search_meetings",
      arguments: { query: "budget", account_id: 99 },
    })
    expect(rejected.isError).toBe(true)
    expect(
      await client.callTool({ name: "search_meetings", arguments: { query: "budget", by_meaning: true } }),
    ).toMatchObject({ isError: true })
    expect(connectStore).toHaveBeenCalledOnce()
  } finally {
    await client.close()
    await server.close()
  }
})
it("reports an unavailable search capability and still closes the connection", async () => {
  const close = vi.fn(async () => {})
  const server = createMeetingMcpServer({
    connectStore: async () => ({ store: memoryMeetingStore(), accountId: 3, close }),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "example-missing-search", version: "1" })
  await client.connect(clientTransport)
  try {
    expect(await client.callTool({ name: "search_meetings", arguments: { query: "budget" } })).toMatchObject({
      isError: true,
    })
    expect(close).toHaveBeenCalledOnce()
  } finally {
    await client.close()
    await server.close()
  }
})
