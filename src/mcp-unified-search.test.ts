import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { expect, it, vi } from "vitest"
import { fakeConnection } from "../scripts/testing/connection.js"
import { createMeetingMcpServer } from "./mcp-server.js"
import type { UnifiedSearchRequest } from "./unified-search.js"

it("advertises opt-in meeting-only unified search without store access, rejects account/resource overrides and closes every call", async () => {
  const search = vi.fn(async (_request: UnifiedSearchRequest) => ({
    query: "example",
    items: [],
    hasMore: null,
    searched: ["meetings"] as "meetings"[],
    skipped: [],
    accounts: [],
    meetings: {
      accountId: 3,
      by: "word-prefixes" as const,
      meetingsScanned: 1,
      complete: false,
      nextCursor: { accountId: 3, query: "example", meetingOffset: 1, hitOffset: 0 },
    },
  }))
  const close = vi.fn(async () => {})
  const connectStore = vi.fn(async () =>
    fakeConnection({ store: memoryMeetingStore(), accountId: 3, unifiedSearch: search, close }),
  )
  const server = createMeetingMcpServer({ connectStore, includeUnifiedSearch: true })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "example-unified-client", version: "1" })
  await client.connect(clientTransport)
  try {
    expect((await client.listTools()).tools.some((tool) => tool.name === "search_all")).toBe(true)
    expect(connectStore).not.toHaveBeenCalled()
    const result = await client.callTool({ name: "search_all", arguments: { query: "example", limit: 10 } })
    expect(result.structuredContent).toMatchObject({ item: { has_more: null, meetings: { complete: false } } })
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
        meeting_cursor: { account_id: 3, query: "example", meeting_offset: 1, hit_offset: 0 },
      },
    })
    expect(continuation.isError).not.toBe(true)
    expect(search.mock.calls[1]?.[0]).toMatchObject({ meetingCursor: { meetingOffset: 1 } })
  } finally {
    await client.close()
    await server.close()
  }
})
