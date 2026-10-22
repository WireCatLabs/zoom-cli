import assert from "node:assert/strict"
import { join } from "node:path"

export const checkInstalledInventory = async ({ load, root }) => {
  const { run, setConfig, TokenManager, createZoomSeriesInventoryReader, createMeetingMcpServer } =
    await load("@wirecat/zoom-cli")
  const { memoryKeyring } = await load("@wirecat/cli-base")
  const { Client } = await load("@modelcontextprotocol/sdk/client/index.js")
  const { InMemoryTransport } = await load("@modelcontextprotocol/sdk/inMemory.js")
  const now = Date.parse("2026-10-18T00:00:00Z")
  const tokens = new TokenManager({
    clientId: "invented-client",
    keyring: memoryKeyring(),
    service: "invented-inventory",
    fetch: async () => {
      throw Error("unexpected token fetch")
    },
    now: () => now,
  })
  const alice = tokens.forProfile("AliceExample", null)
  alice.save({
    accessToken: "invented-access",
    refreshToken: "invented-refresh",
    expiresAt: now + 3600000,
    scopes: ["meeting:read:list_meetings"],
  })
  let requests = 0,
    storeCalls = 0
  const fetcher = async (url) => {
    requests++
    const parsed = new URL(String(url))
    assert.equal(parsed.origin, "https://api.zoom.us")
    assert.equal(parsed.pathname, "/v2/users/me/meetings")
    assert.equal(parsed.searchParams.get("type"), "scheduled")
    return new Response(
      JSON.stringify({
        meetings: [
          {
            id: 123,
            type: 8,
            topic: "Harbour Example",
            start_time: "2026-10-01T10:00:00Z",
            join_url: "https://example.test/discard",
          },
        ],
        next_page_token: "next-example",
      }),
    )
  }
  const configPath = join(root, "inventory-config.json")
  setConfig(configPath, "zoom.client_id", "invented-client")
  const output = []
  const deps = {
    configPath,
    tokens,
    fetch: fetcher,
    now: () => now,
    data: (text) => output.push(text),
    diagnostic: () => {},
    openBrowser: async () => {
      throw Error("unexpected browser")
    },
    connectStore: async () => {
      storeCalls++
      throw Error("unexpected store")
    },
  }
  assert.equal(await run(["AliceExample", "meetings", "scheduled", "--limit", "1", "--json"], deps), 0)
  const answer = JSON.parse(output.join(""))
  assert.equal(answer.item.items[0].meeting_id, "123")
  assert.equal(answer.item.coverage.date_hints_outside_window, 1)
  assert.equal(answer.item.coverage.occurrence_proof, "not-read")
  assert.equal(answer.item.coverage.calendar_completeness, "unknown")
  assert.ok(!JSON.stringify(answer).includes("join_url"))
  assert.ok(answer.item.page.next_cursor)
  const before = requests
  assert.notEqual(await run(["AliceExample", "--offline", "meetings", "scheduled", "--json"], deps), 0)
  assert.equal(requests, before)
  const reader = createZoomSeriesInventoryReader("zm-profile:AliceExample", alice, fetcher)
  const server = createMeetingMcpServer({
    connectStore: deps.connectStore,
    inventory: (request) => reader.page(request),
    now: () => now,
  })
  const client = new Client({ name: "invented-inventory-agent", version: "1" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === "meeting_series_inventory"))
    const invalid = await client.callTool({ name: "meeting_series_inventory", arguments: { account: "other" } })
    assert.equal(invalid.isError, true)
    assert.match(JSON.stringify(invalid.structuredContent), /account/)
    assert.equal(requests, before)
    const result = await client.callTool({ name: "meeting_series_inventory", arguments: { limit: 1 } })
    assert.notEqual(result.isError, true)
    assert.equal(result.structuredContent.item.scope.account, "zm-profile:AliceExample")
    assert.ok(result.structuredContent.meta.run_id)
  } finally {
    await client.close()
    await server.close()
  }
  assert.equal(storeCalls, 0)
  return {
    inventory_installed_cli: true,
    inventory_installed_mcp: true,
    inventory_strict_arguments: true,
    inventory_no_store: true,
    inventory_offline_boundary: true,
    inventory_unverified_hints: true,
  }
}
