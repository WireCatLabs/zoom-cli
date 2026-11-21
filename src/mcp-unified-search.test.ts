import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { memoryMeetingStore } from "@wirecat/cli-messaging/meetings/testing"
import { expect, it, vi } from "vitest"
import { createMeetingMcpServer } from "./mcp-server.js"
import type { UnifiedSearchRequest } from "./unified-search.js"

it("advertises opt-in meeting-only unified search without store access, rejects account/resource overrides and closes every call", async () => {
  const search = vi.fn(async (_request: UnifiedSearchRequest) => ({
    query: "example",
    items: [],
    hasMore: null,
    searched: ["meetings"] as "meetings"[],
    skipped: [],
    meetings: {
      accountId: 3,
      by: "word-prefixes" as const,
      meetingsScanned: 1,
      complete: false,
      nextCursor: { accountId: 3, query: "example", meetingOffset: 1, hitOffset: 0 },
    },
  }))
  const close = vi.fn(async () => {})
  const connectStore = vi.fn(async () => ({ store: memoryMeetingStore(), accountId: 3, unifiedSearch: search, close }))
  const server = createMeetingMcpServer({ connectStore, includeUnifiedSearch: true })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "example-unified-client", version: "1" })
  await client.connect(clientTransport)
  try {
    expect((await client.listTools()).tools.some((tool) => tool.name === "search_all")).toBe(true)
    expect(connectStore).not.toHaveBeenCalled()
    const result = await client.callTool({ name: "search_all", arguments: { query: "example", limit: 10 } })
    expect(result.structuredContent).toMatchObject({ hasMore: null, meetings: { complete: false } })
    expect(search.mock.calls[0]?.[0]).toMatchObject({ only: ["meetings"], text: "example", limit: 10 })
    expect(close).toHaveBeenCalledOnce()
    for (const override of [
      { account_id: 99 },
      { only: ["notes"] },
      { meetingAccount: { provider: "zoom", account: "other" } },
    ]) {
      const rejected = await client.callTool({ name: "search_all", arguments: { query: "example", ...override } })
      expect(rejected.isError).toBe(true)
    }
    expect(connectStore).toHaveBeenCalledOnce()
    const continuation = await client.callTool({
      name: "search_all",
      arguments: {
        query: "example",
        meeting_cursor: { accountId: 3, query: "example", meetingOffset: 1, hitOffset: 0 },
      },
    })
    expect(continuation.isError).not.toBe(true)
    expect(search.mock.calls[1]?.[0]).toMatchObject({ meetingCursor: { meetingOffset: 1 } })
  } finally {
    await client.close()
    await server.close()
  }
})

it("reports missing unified service and closes its optional read connection", async () => {
  const close = vi.fn(async () => {})
  const server = createMeetingMcpServer({
    includeUnifiedSearch: true,
    connectStore: async () => ({ store: memoryMeetingStore(), accountId: 1, close }),
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(b)
  const client = new Client({ name: "example-client", version: "1" })
  await client.connect(a)
  try {
    const result = await client.callTool({ name: "search_all", arguments: { query: "example" } })
    expect(result.structuredContent).toMatchObject({ error: { code: "configuration_error" } })
    expect(close).toHaveBeenCalledOnce()
  } finally {
    await client.close()
    await server.close()
  }
})
