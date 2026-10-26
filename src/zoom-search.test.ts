import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { expect, it } from "vitest"
import { declaredAnswerIssue } from "../scripts/testing/answers.js"
import { useProfile } from "../scripts/testing/profile.js"
import { setConfig } from "./config.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"
import { ZOOM_MCP_URL } from "./zoom-mcp.js"
import { ZoomSearch, type ZoomSearchRequest } from "./zoom-search.js"
import type { ZoomSearchService } from "./zoom-search-commands.js"

const login = (scopes = ["agentic_search:read:search"]) => ({
  tokens: async () => ({ accessToken: "example-access", refreshToken: "example-refresh", expiresAt: 3600000, scopes }),
})
const stream = (value: unknown, headers: Record<string, string> = {}) =>
  new Response(`event: message\ndata: ${JSON.stringify(value)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  })
const searchResult = (id: number, body: unknown) =>
  stream({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(body) }] } })

const meeting = {
  datasource: "zoom_meeting",
  meeting_uuid: "uuid-1",
  topic: "Example planning",
  meeting_start_time: "2026-10-01T09:00:00Z",
  meeting_roles: ["attendee"],
  has_transcript: false,
  attendees: [{ display_name: "Alice Example" }, { display_name: "Bob Sample" }],
}
const chat = {
  datasource: "zoom_chat_message",
  session_id: "chat-1",
  session_name: "Example team",
  messages: [
    { message_id: "m-1", message: "the example budget", sent_time: "2026-10-02T10:00:00Z" },
    { message_id: "m-2", message: "budget agreed", sent_time: "2026-10-02T10:05:00Z" },
  ],
}

it("opens one MCP session, then searches with Zoom's datasource names and maps each chat message to a hit", async () => {
  const sent: { method: string; params: Record<string, unknown>; session: string | null }[] = []
  const search = new ZoomSearch(login(), async (input, init) => {
    expect(String(input)).toBe(ZOOM_MCP_URL)
    const body = JSON.parse(String(init?.body))
    sent.push({ method: body.method, params: body.params, session: new Headers(init?.headers).get("mcp-session-id") })
    if (body.method === "initialize")
      return stream({ jsonrpc: "2.0", id: body.id, result: {} }, { "mcp-session-id": "s-1" })
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
    return searchResult(body.id, { data: [meeting, chat], has_more: true, next_page_token: "page-2" })
  })
  const page = await search.search({ query: " budget ", sources: ["chat", "meetings"], limit: 5 })
  await search.search({ query: "budget", cursor: "page-2" })
  expect(sent.map((call) => call.method)).toEqual([
    "initialize",
    "notifications/initialized",
    "tools/call",
    "tools/call",
  ])
  expect(sent.slice(1).every((call) => call.session === "s-1")).toBe(true)
  expect(sent[2]?.params).toEqual({
    name: "search",
    arguments: {
      query: "budget",
      page_size: 5,
      datasource_filters: [{ datasource: "zoom_chat_message" }, { datasource: "zoom_meeting" }],
    },
  })
  expect(sent[3]?.params.arguments).toEqual({ query: "budget", page_size: 10, next_page_token: "page-2" })
  expect(page.has_more).toBe(true)
  expect(page.cursor).toBe("page-2")
  expect(page.items.map((hit) => [hit.source, hit.id, hit.title, hit.text, hit.container_id])).toEqual([
    ["meetings", "uuid-1", "Example planning", null, null],
    ["chat", "m-1", "Example team", "the example budget", "chat-1"],
    ["chat", "m-2", "Example team", "budget agreed", "chat-1"],
  ])
  expect(page.items[0]).toMatchObject({
    time: "2026-10-01T09:00:00Z",
    people: ["Alice Example", "Bob Sample"],
    details: { has_transcript: false },
  })
})

it("says which scope is missing, before asking Zoom and when Zoom refuses, and passes a license refusal on", async () => {
  const offline = async () => {
    throw new Error("unexpected network")
  }
  await expect(new ZoomSearch(login([]), offline).search({ query: "x" })).rejects.toThrow(
    /agentic_search:read:search is missing/,
  )
  const refusing = new ZoomSearch(login(), async () =>
    Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32003, message: "hub_content:read" } }, { status: 403 }),
  )
  await expect(refusing.search({ query: "x" })).rejects.toThrow(/wants scope hub_content:read/)
  const unlicensed = new ZoomSearch(login(), async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.method !== "tools/call") return stream({ jsonrpc: "2.0", id: body.id, result: {} })
    const refusal = { status_code: 403, error_message: "User does not have a valid license for Search." }
    return stream({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        isError: true,
        content: [{ type: "text", text: `HTTP 403 Forbidden error: ${JSON.stringify(refusal)}` }],
      },
    })
  })
  await expect(unlicensed.search({ query: "x" })).rejects.toMatchObject({
    code: "permission_error",
    message: expect.stringContaining("valid license for Search"),
  })
})

it("answers zoom search as declared hits, checks its options and pages with the cursor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-zoom-search-"))
  const stdout: string[] = []
  const asked: ZoomSearchRequest[] = []
  const zoomSearch: ZoomSearchService = {
    search: async (request) => {
      asked.push(request)
      return {
        items: [
          {
            source: "docs",
            id: "file-1",
            title: "Example plan",
            time: "2026-10-03T08:00:00Z",
            text: null,
            url: "https://example.zoom.us/doc/file-1",
            people: [],
            container_id: null,
            details: { file_type: "doc" },
          },
        ],
        has_more: true,
        cursor: "page-2",
      }
    },
  }
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({ clientId: "example-client", keyring: memoryKeyring(), service: "example", fetch }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    store: memoryMeetingStore(),
    accountId: 1,
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: () => {},
    zoomSearch,
  }
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  useProfile(deps.configPath, "work")
  const argv = ["zoom", "search", "plan", "--only", "docs,chat", "--limit", "20", "--json"]
  expect(await run(argv, deps)).toBe(0)
  const body = JSON.parse(stdout.join(""))
  expect(declaredAnswerIssue(createProgram(deps), "zoom search", body)).toBeUndefined()
  expect(body.page.next_cursor).toBe("page-2")
  expect(asked[0]).toMatchObject({ query: "plan", sources: ["docs", "chat"], limit: 20 })
  stdout.length = 0
  expect(await run(["zoom", "search", "--cursor", "page-2", "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).page.next_cursor).toBe("page-2")
  expect(await run(["zoom", "search", "plan", "--only", "files", "--json"], deps)).not.toBe(0)
  expect(await run(["zoom", "search", "plan", "--limit", "101", "--json"], deps)).not.toBe(0)
  expect(asked).toHaveLength(2)
  expect(asked[1]).toMatchObject({ query: undefined, cursor: "page-2", limit: 10 })
})

const answering = (toolCall: (id: number) => Response | Promise<Response>) =>
  new ZoomSearch(login(), async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.method === "initialize") return stream({ jsonrpc: "2.0", id: body.id, result: {} })
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
    return toolCall(body.id)
  })

it("turns an unreachable server, a lapsed login, a failed request and an unreadable answer into clear errors", async () => {
  const unreachable = answering(() => {
    throw new TypeError("fetch failed")
  })
  await expect(unreachable.search({ query: "x" })).rejects.toMatchObject({ code: "network_error" })
  await expect(answering(() => new Response("", { status: 401 })).search({ query: "x" })).rejects.toMatchObject({
    code: "authentication_error",
  })
  await expect(answering(() => new Response("busy", { status: 503 })).search({})).rejects.toThrow(/HTTP 503/)
  const rpcError = (id: number) => Response.json({ jsonrpc: "2.0", id, error: { message: "search is down" } })
  await expect(answering(rpcError).search({})).rejects.toThrow(/search failed: search is down/)
  await expect(answering(() => new Response("")).search({})).rejects.toMatchObject({ code: "invalid_response" })
  const notJson = (id: number) =>
    stream({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "<html>" }] } })
  await expect(answering(notJson).search({})).rejects.toThrow(/invalid search answer/)
  await expect(answering((id) => searchResult(id, { items: [] })).search({})).rejects.toThrow(/invalid search answer/)
  await expect(answering((id) => searchResult(id, { data: ["row"] })).search({})).rejects.toThrow(
    /invalid search result/,
  )
})

it("reads a hit from Zoom's structured answer when a row has none of the usual id, time or text keys", async () => {
  const doc = {
    datasource: "zoom_canvas",
    doc_ref_id: "doc-9",
    last_edit_time: "2026-10-04T12:00:00Z",
    chunks: ["first part", { text: "second part" }, 3],
    owner: { name: "nested values are left out of details" },
  }
  const structured = (id: number) =>
    stream({ jsonrpc: "2.0", id, result: { content: [], structuredContent: { data: [doc], has_more: false } } })
  const page = await answering(structured).search({ query: "part" })
  expect(page).toEqual({
    has_more: false,
    items: [
      {
        source: "docs",
        id: "doc-9",
        title: null,
        time: "2026-10-04T12:00:00Z",
        text: "first part\nsecond part",
        url: null,
        people: [],
        container_id: null,
        details: { doc_ref_id: "doc-9", last_edit_time: "2026-10-04T12:00:00Z" },
      },
    ],
  })
})
