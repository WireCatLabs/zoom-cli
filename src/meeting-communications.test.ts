import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { expect, it, vi } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { communicationsFixture } from "../scripts/testing/communications.js"
import { readConfig, setConfig } from "./config.js"
import { createMeetingMcpServer } from "./mcp-server.js"
import { captureContextSources } from "./meeting-communications-binding.js"
import { readPreparationTool } from "./meeting-preparation-mcp.js"
import { run } from "./program.js"

const selections = ["work-messages", "work-mail", "project-files"]
const input = { series_id: "123", communications: { sources: selections.map((id) => ({ id })), query: "launch" } }

it("joins conflicting dated statements through the actual read-only SDK without writing or inferring a winner", async () => {
  const f = await communicationsFixture()
  const digest = () => createHash("sha256").update(readFileSync(f.path)).digest("hex"),
    before = digest()
  const args = ["meetings", "prepare", "123", "--context-query", "launch", "--json"]
  for (const id of selections) args.push("--context-source", id)
  expect(await run(args, f.deps)).toBe(0)
  const item = readAnswer(f.output.join("")),
    section = item.communications
  expect(section.items).toHaveLength(3)
  expect(section.items.map((i: { text: string }) => i.text)).toEqual([
    "Launch Friday: target Monday.",
    "Launch Monday: target Tuesday.",
    "Launch Tuesday: target Wednesday.",
  ])
  expect(new Set(section.items.map((i: { ref: string }) => i.ref)).size).toBe(3)
  expect(section.coverage.sources.map((s: { state: string }) => s.state)).toEqual(["searched", "searched", "searched"])
  expect(JSON.stringify(section)).not.toContain("BobSample")
  expect(f.connectStore).toHaveBeenCalledWith(expect.objectContaining({ intent: "preparation" }))
  expect(f.network).toHaveBeenCalledOnce()
  expect(f.closed).toHaveBeenCalledOnce()
  expect(digest()).toBe(before)
  const mcp = await readPreparationTool(f.mcp, input, new AbortController().signal)
  expect(mcp.structuredContent).toMatchObject({ item: { communications: section } })
})

it("rejects an unconfigured selection before credentials, database opening or Zoom reads", async () => {
  const f = await communicationsFixture(),
    load = vi.spyOn(f.tokens, "load")
  expect(
    await run(
      ["meetings", "prepare", "123", "--context-source", "foreign", "--context-query", "launch", "--json"],
      f.deps,
    ),
  ).not.toBe(0)
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it("validates raw MCP nested arguments before any protected reads", async () => {
  const f = await communicationsFixture(),
    load = vi.spyOn(f.tokens, "load")
  const result = await readPreparationTool(
    f.mcp,
    { ...input, communications: { ...input.communications, account_id: 99 } },
    new AbortController().signal,
  )
  expect(result).toMatchObject({ isError: true })
  expect(JSON.stringify(result)).toContain("validation_error")
  expect(JSON.stringify(result)).toContain("account_id")
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it("keeps source coverage when the caller projects only excerpt references", async () => {
  const f = await communicationsFixture()
  expect(
    await run(
      [
        "meetings",
        "prepare",
        "123",
        "--context-source",
        "work-messages",
        "--context-query",
        "launch",
        "--json=communications.items.ref",
      ],
      f.deps,
    ),
  ).toBe(0)
  const section = readAnswer(f.output.join("")).communications
  expect(section.items).toHaveLength(1)
  expect(Object.keys(section.items[0])).toEqual(["ref"])
  expect(section.coverage.sources[0]).toMatchObject({ selection_id: "work-messages", state: "searched" })
})

it("exposes only captured MCP selection IDs and cannot expand after source configuration changes", async () => {
  const f = await communicationsFixture()
  const getContext = vi.fn(() => captureContextSources(readConfig(f.deps.configPath).contextSources, "AliceExample"))
  const server = createMeetingMcpServer({ ...f.mcp, preparation: { ...f.mcp.preparation, context: getContext } })
  const client = new Client({ name: "invented-context-agent", version: "1" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const tools = await client.listTools(),
      tool = tools.tools.find((t) => t.name === "meeting_prepare")
    expect(JSON.stringify(tool?.inputSchema)).toContain('"enum":["work-messages","work-mail","project-files"]')
    expect(f.connectStore).not.toHaveBeenCalled()
    setConfig(
      f.deps.configPath,
      "context.sources",
      JSON.stringify([
        ...f.sources,
        { id: "foreign", kind: "message", provider: "example-messenger", account: "BobSample" },
      ]),
    )
    const bad = await client.callTool({
      name: "meeting_prepare",
      arguments: { ...input, communications: { ...input.communications, sources: [{ id: "foreign" }] } },
    })
    expect(bad.isError).toBe(true)
    expect(f.connectStore).not.toHaveBeenCalled()
    const result = await client.callTool({ name: "meeting_prepare", arguments: input })
    expect(result.isError).not.toBe(true)
    expect(getContext).toHaveBeenCalledOnce()
  } finally {
    await client.close()
    await server.close()
  }
})
