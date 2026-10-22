import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { memoryKeyring } from "@wirecat/cli-base"
import { type CommandInfo, describeProgram } from "@wirecat/cli-base/commands"
import { afterEach, expect, it, vi } from "vitest"
import { useProfile } from "../scripts/testing/profile.js"
import type { RemoteMeetingsService } from "./archive-commands.js"
import { setConfig } from "./config.js"
import { createZoomMcpServer, type ZoomMcpOptions } from "./mcp.js"
import { runForAgent } from "./mcp-command.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

interface Answer {
  items: { command: string; excerpt: string }[]
  error: { code: string }
}

const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close()
})

const setup = async (permissions?: Record<string, string>, line = "Ship the example plan.") => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-mcp-"))
  const store = join(directory, "store.db")
  const env: Record<string, string> = {
    MESSAGING_STORE: store,
    HOME: directory,
    XDG_DATA_HOME: join(directory, "data"),
  }
  const created = vi.fn(async (_change: unknown, options?: { apply?: boolean }) => ({
    action: "create",
    applied: options?.apply === true,
    request: { method: "POST", path: "/users/me/meetings" },
  }))
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    env,
    tokens: new TokenManager({ clientId: "example-client", keyring: memoryKeyring(), service: "example", fetch }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    connectStore: createStoreConnector({ path: store, env }),
    openBrowser: async () => {},
    data: () => {},
    diagnostic: () => {},
    remoteMeetings: { create: created } as unknown as RemoteMeetingsService,
  }
  setConfig(deps.configPath, "zoom.clientId", "example-client")
  useProfile(deps.configPath, "work", env)
  delete env.ZM_PROFILE
  const transcripts = join(directory, "transcripts")
  await import("node:fs/promises").then((fs) => fs.mkdir(transcripts))
  await writeFile(
    join(transcripts, "2026-10-01_1000_example-planning.vtt"),
    `WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nAlice Example: ${line}\n`,
  )
  expect(await run(["work", "meetings", "import", transcripts, "--json"], deps)).toBe(0)
  if (permissions)
    setConfig(
      deps.configPath,
      "permissions",
      JSON.stringify(permissions),
      () => "work",
      new Set(Object.keys(permissions)),
    )
  const server = createZoomMcpServer({
    profile: "work",
    commands: describeProgram(createProgram(deps)),
    permissions: () => (permissions ?? {}) as Record<string, never>,
    run: (argv) => runForAgent(run, argv, deps),
  })
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "example", version: "1" })
  await server.connect(serverSide)
  await client.connect(clientSide)
  clients.push(client)
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent: Answer }
  return { client, call, created, deps }
}

it("offers three tools and runs a stored read as the command line does", async () => {
  const { client, call } = await setup()
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["zm_tools_search", "zm_read", "zm_write"])
  const found = await call("zm_tools_search", { query: "meetings list" })
  expect(found.structuredContent.items[0]).toMatchObject({ command: "meetings list", writes: false })
  const listed = await call("zm_read", { command: "meetings list", arguments: {} })
  expect(listed.structuredContent.items[0]).toMatchObject({ title: "example planning", account: "zm-profile:work" })
  const passage = await call("zm_write", { command: "search meetings", arguments: { query: "example plan" } })
  expect(passage.structuredContent.items[0]?.excerpt).toContain("Ship the example plan")
})

it("leaves login, settings and the server itself out", async () => {
  const { call } = await setup()
  const all = (await call("zm_tools_search", {})).structuredContent.items.map(
    (item: { command: string }) => item.command,
  )
  expect(all).toContain("remote-meetings create")
  for (const hidden of ["session start", "config set", "mcp", "serve", "watch"]) expect(all).not.toContain(hidden)
})

it("takes ask as yes, since no one is at a terminal, and withholds what the profile denies", async () => {
  const asked = await setup()
  const created = await asked.call("zm_write", {
    command: "remote-meetings create",
    arguments: { title: "Example", type: "1" },
  })
  expect(created.isError).toBeFalsy()
  expect(asked.created).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apply: true }))

  const denied = await setup({ "remote-meetings": "readonly" })
  const all = (await denied.call("zm_tools_search", {})).structuredContent.items.map(
    (item: { command: string }) => item.command,
  )
  expect(all).toContain("remote-meetings list")
  expect(all).not.toContain("remote-meetings create")
  const refused = await denied.call("zm_write", {
    command: "remote-meetings create",
    arguments: { title: "Example", type: "1" },
  })
  expect(refused.isError).toBe(true)
  expect(denied.created).not.toHaveBeenCalled()
})

it("answers a command's own failure as its error object", async () => {
  const { call } = await setup()
  const missing = await call("zm_read", { command: "meetings show", arguments: { meeting: "999999" } })
  expect(missing.isError).toBe(true)
  expect(missing.structuredContent.error.code).toBe("not_found")
})

it("shows hidden control and direction characters in an answer instead of passing them to the agent", async () => {
  const hidden = [String.fromCodePoint(0xe0041), String.fromCodePoint(0x202e), String.fromCodePoint(0x200b)]
  const ordinary = "Привет 👋"
  const { call } = await setup(undefined, `Ship the${hidden.join("")} rules ${ordinary}`)
  const found = await call("zm_write", { command: "search meetings", arguments: { query: "rules" } })
  const text = JSON.stringify(found)
  expect(found.structuredContent.items[0]?.excerpt).toContain(ordinary)
  for (const character of hidden) expect(text).not.toContain(character)
})

it("serves the named profile's commands from the command line", async () => {
  const { deps } = await setup()
  const serveMcp = vi.fn(async (_options: ZoomMcpOptions) => {})
  expect(await run(["work", "mcp"], { ...deps, serveMcp })).toBe(0)
  const [options] = serveMcp.mock.calls[0] ?? []
  expect(options?.profile).toBe("work")
  const paths = (commands: readonly CommandInfo[]): string[] =>
    commands.flatMap((command) => [command.path.join(" "), ...paths(command.commands)])
  expect(paths(options?.commands ?? [])).toContain("meetings list")
})

it("points the old serve command at the profile's mcp command", async () => {
  const { deps } = await setup()
  const errors: string[] = []
  const serveMcp = vi.fn(async (_options: ZoomMcpOptions) => {})
  expect(await run(["work", "serve", "--mcp"], { ...deps, serveMcp, diagnostic: (text) => errors.push(text) })).toBe(2)
  expect(errors.join("")).toContain("zm <profile> mcp")
  expect(serveMcp).not.toHaveBeenCalled()
})
