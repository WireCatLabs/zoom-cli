import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { afterEach, expect, it, vi } from "vitest"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

it("says whether npm has a newer zm and installs nothing with --check", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-upgrade-"))
  const registry = vi.fn(
    async (_url: string | URL) => new Response(JSON.stringify({ version: "99.0.0" }), { status: 200 }),
  )
  vi.stubGlobal("fetch", registry)
  const stdout: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({ clientId: "", keyring: memoryKeyring(), service: "example", fetch }),
    fetch: async () => {
      throw new Error("unexpected Zoom request")
    },
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: () => {},
  }
  expect(await run(["upgrade", "--check", "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).item).toMatchObject({ latest: "99.0.0", newer: true, updated: false })
  expect(String(registry.mock.calls[0]?.[0])).toContain("zoom-cli")
})
