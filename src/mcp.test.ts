import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { afterEach, expect, it, vi } from "vitest"
import { mcpClient } from "../scripts/testing/mcp.js"
import { useProfile } from "../scripts/testing/profile.js"
import type { RecordingsService, RemoteMeetingsService } from "./archive-commands.js"
import { setConfig } from "./config.js"
import type { ProgramDeps } from "./program.js"
import { run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

interface Answer {
  items: { command: string; excerpt: string }[]
  error: { code: string }
}

const closers: (() => Promise<number>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

const setup = async (
  permissions?: Record<string, string>,
  line = "Ship the example plan.",
  overrides: Partial<ProgramDeps> = {},
) => {
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
  setConfig(deps.configPath, "zoom.client_id", "example-client")
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
  Object.assign(deps, overrides)
  const { client, close } = await mcpClient(deps)
  closers.push(close)
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
  const passage = await call("zm_read", { command: "search meetings", arguments: { query: "example plan" } })
  expect(passage.structuredContent.items[0]?.excerpt).toContain("Ship the example plan")
})

it("offers finite commands and reserves authority changes for an explicit grant", async () => {
  const { call } = await setup()
  const all = (await call("zm_tools_search", {})).structuredContent.items.map((item) => item.command)
  for (const offered of [
    "remote-meetings create",
    "guide",
    "session status",
    "config show",
    "skill show",
    "meetings embeddings",
  ])
    expect(all).toContain(offered)
  for (const hidden of ["session start", "mcp", "serve", "watch"]) expect(all).not.toContain(hidden)

  for (const path of ["config set", "skill install"]) {
    expect(all).toContain(path)
    const described = (await call("zm_tools_search", { query: path })).structuredContent.items.find(
      (item) => item.command === path,
    )
    expect(described).toMatchObject({ availability: { available: false, permission: "mcp.authority" } })
  }
  const granted = await setup({ "mcp.authority": "allow" })
  const withAuthority = (await granted.call("zm_tools_search", {})).structuredContent.items.map((item) => item.command)
  expect(withAuthority).toContain("config set")
  expect(withAuthority).toContain("skill install")
  const changed = await granted.call("zm_write", {
    command: "config set",
    arguments: { key: "files.timezone", value: "UTC" },
  })
  expect(changed.isError).toBeFalsy()
  const escalation = await granted.call("zm_write", {
    command: "config set",
    arguments: { key: "permissions", value: '{"mcp.authority":"allow"}' },
  })
  expect(escalation.isError).toBe(true)
  expect(escalation.structuredContent.error.code).toBe("permission_error")
})

it("takes ask as yes, since no one is at a terminal, and marks denied commands unavailable", async () => {
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
  expect(all).toContain("remote-meetings create")
  const found = (
    await denied.call("zm_tools_search", { query: "remote-meetings create" })
  ).structuredContent.items.find((item) => item.command === "remote-meetings create")
  expect(found).toMatchObject({ availability: { available: false, permission: "remote-meetings.create" } })
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
  const found = await call("zm_read", { command: "search meetings", arguments: { query: "rules" } })
  const text = JSON.stringify(found)
  expect(found.structuredContent.items[0]?.excerpt).toContain(ordinary)
  for (const character of hidden) expect(text).not.toContain(character)
})

it("refuses an authority command after its grant is revoked", async () => {
  const { call, deps } = await setup({ "mcp.authority": "allow" })
  setConfig(deps.configPath, "permissions", '{"mcp.authority":"deny"}', () => "work", new Set(["mcp.authority"]))
  const refused = await call("zm_write", {
    command: "config set",
    arguments: { key: "files.timezone", value: "UTC" },
  })
  expect(refused.isError).toBe(true)
  expect(refused.structuredContent.error.code).toBe("permission_error")
})

it("runs native shared discovery and guides with Core's agent environment and keeps their structured answers", async () => {
  const { call } = await setup()
  const guide = await call("zm_read", { command: "guide", arguments: { name: "find-quote" } })
  expect(guide.isError).toBeFalsy()
  expect(guide.structuredContent).toMatchObject({ item: { name: "find-quote" } })
  const contract = await call("zm_read", { command: "commands info", arguments: { path: ["meetings", "export"] } })
  expect(contract.isError).toBeFalsy()
  expect(contract.structuredContent).toMatchObject({
    item: {
      outputSchemaCoverage: "declared-entity",
      jsonlSchema: { anyOf: expect.any(Array) },
    },
  })
})

it("runs date-range downloads through the same typed command over MCP", async () => {
  const recordings: RecordingsService = {
    list: vi.fn(),
    show: vi.fn(),
    catalog: () => ({
      provider: "zoom",
      list: async () => ({
        items: [{ id: "123456789", externalId: "example-occurrence", title: "Example", startedAt: null, assets: [] }],
        nextCursor: null,
      }),
    }),
    download: async () => ({
      uuid: "example-occurrence",
      manifestPath: "example.json",
      downloaded: [],
      skipped: [],
      unavailable: [],
    }),
  }
  const { deps, call } = await setup(undefined, undefined, { recordings })
  const answer = await call("zm_write", {
    command: "recordings download",
    arguments: {
      since_time: "2026-10-01",
      until_time: "2026-10-11",
      output_dir: join(deps.configPath, "..", "archive"),
      resume: false,
    },
  })
  expect(answer.isError).toBeFalsy()
  expect(answer.structuredContent).toMatchObject({ items: [{ meeting: { uuid: "example-occurrence" } }] })
})

it("serves under ZM_READ_ONLY, reads still answer and Zoom changes are refused", async () => {
  const base = await setup()
  const { call } = await setup(undefined, undefined, { env: { ...base.deps.env, ZM_READ_ONLY: "1" } })
  expect((await call("zm_read", { command: "meetings list", arguments: {} })).isError).toBeFalsy()
  const refused = await call("zm_write", {
    command: "remote-meetings create",
    arguments: { title: "Example", type: "1" },
  })
  expect(refused.isError).toBe(true)
  expect(refused.structuredContent.error.code).toBe("permission_error")
})

it("makes a permission stricter for one server with --permission, and refuses one that would loosen it", async () => {
  const { deps } = await setup()
  const { client, close } = await mcpClient(deps, ["work", "mcp", "serve", "--permission", "meetings=deny"])
  closers.push(close)
  const listed = await client.callTool({ name: "zm_read", arguments: { command: "meetings list", arguments: {} } })
  expect(listed.isError).toBe(true)

  const err: string[] = []
  expect(
    await run(["work", "mcp", "serve", "--permission", "remote-meetings=allow"], {
      ...deps,
      diagnostic: (text) => err.push(text),
    }),
  ).toBe(2)
  expect(err.join("")).toContain("would loosen")
  expect(await run(["work", "mcp", "serve", "--permission", "nope.list=deny"], { ...deps, diagnostic: () => {} })).toBe(
    2,
  )
})

it("refuses mcp serve --http without the tunnel's address, and offers the shared HTTP flags", async () => {
  const { deps } = await setup()
  const err: string[] = []
  const code = await run(["work", "mcp", "serve", "--http"], { ...deps, diagnostic: (text) => err.push(text) })
  expect(code).toBe(3)
  expect(err.join("")).toContain("--public-url")
  const help: string[] = []
  await run(["mcp", "serve", "--help"], { ...deps, data: (text) => help.push(text), diagnostic: () => {} })
  for (const flag of ["--http", "--port <port>", "--public-url <url>", "--permission <key=level>", "--profiles"])
    expect(help.join("")).toContain(flag)
})

const output = async (argv: string[], overrides: Partial<ProgramDeps> = {}) => {
  const { deps } = await setup()
  const out: string[] = []
  const code = await run(argv, { ...deps, ...overrides, data: (text) => out.push(text), diagnostic: () => {} })
  return { code, item: out.length > 0 ? JSON.parse(out.join("")).item : undefined }
}

it("forgets every browser login on mcp revoke, for one profile and for all", async () => {
  expect(await output(["work", "mcp", "revoke", "--json"])).toMatchObject({ code: 0, item: { revoked: true } })
  expect(await output(["mcp", "revoke", "--profiles", "all", "--json"])).toMatchObject({
    code: 0,
    item: { revoked: true, profiles: "all" },
  })
})

it("reports a server that is not running on mcp server status, for one profile and for all", async () => {
  expect(await output(["work", "mcp", "server", "status", "--json"])).toMatchObject({
    code: 0,
    item: { profile: "work", running: false },
  })
  expect(await output(["mcp", "server", "status", "--profiles", "all", "--json"])).toMatchObject({
    code: 0,
    item: { profiles: "all", running: false },
  })
})

it("prints the agent's MCP entry on mcp config with the profiles and permissions it was given", async () => {
  const { code, item } = await output(["mcp", "config", "--profiles", "all", "--permission", "meetings=deny", "--json"])
  expect(code).toBe(0)
  expect(item.config.mcpServers.zm.args).toEqual(
    expect.arrayContaining(["mcp", "serve", "--profiles", "all", "--permission", "meetings=deny"]),
  )
})

it("never reads the protocol's stdin as batch input", async () => {
  const readBatchInput = vi.fn(async () => "{}")
  const { call } = await setup(undefined, undefined, { readBatchInput })
  const answer = await call("zm_read", { command: "batch", arguments: { file: "-" } })
  expect(answer.isError).toBe(true)
  expect(readBatchInput).not.toHaveBeenCalled()
})
