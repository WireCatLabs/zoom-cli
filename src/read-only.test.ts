import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { memoryKeyring } from "@wirecat/cli-base"
import { checkGuide } from "@wirecat/cli-core/cli"
import { describe, expect, it, vi } from "vitest"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const setup = async (env: NodeJS.ProcessEnv) => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-read-only-"))
  const network = vi.fn(async (): Promise<Response> => {
    throw new Error("unexpected network")
  })
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: memoryKeyring(),
      service: "example",
      fetch: network,
    }),
    fetch: network,
    connectStore: vi.fn(async () => {
      throw new Error("unexpected store")
    }),
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: () => {},
    diagnostic: (text) => stderr.push(text),
    env: { ...env, HOME: directory },
  }
  return { deps, network, stderr }
}

describe("ZM_READ_ONLY", () => {
  it.each([
    [["remote-meetings", "create", "--title", "Example", "--yes"]],
    [["remote-meetings", "cancel", "123456789", "--yes"]],
    [["session", "start"]],
    [["meetings", "sync"]],
    [["meetings", "import", "./downloaded"]],
    [["recordings", "download", "123456789", "--output-dir", "/tmp/zm-archive"]],
    [["config", "set", "account.profile", "personal"]],
    [["skill", "install"]],
    [["watch"]],
    [["search", "meetings", "budget", "--model", "e5-small"]],
  ])("refuses %j with exit 5 before any network or store call", async (args) => {
    const { deps, network, stderr } = await setup({ ZM_READ_ONLY: "1" })
    expect(await run([...args, "--json"], deps)).toBe(5)
    expect(stderr.join("")).toContain("this process is read-only (ZM_READ_ONLY)")
    expect(network).not.toHaveBeenCalled()
    expect(deps.connectStore).not.toHaveBeenCalled()
  })

  it("lets reads through, word search and its index included", async () => {
    const { deps, stderr } = await setup({ ZM_READ_ONLY: "1" })
    expect(await run(["doctor", "--json"], deps)).toBe(0)
    expect(await run(["search", "meetings", "budget", "--json"], deps)).not.toBe(5)
    expect(stderr.join("")).not.toContain("read-only")
  })

  it("is off when set to 0", async () => {
    const { deps, stderr } = await setup({ ZM_READ_ONLY: "0" })
    await run(["config", "set", "account.profile", "personal", "--json"], deps)
    expect(stderr.join("")).not.toContain("read-only")
  })
})

it("keeps every scenario step runnable", async () => {
  const { deps } = await setup({})
  const packageRoot = fileURLToPath(new URL("..", import.meta.url))
  expect(await checkGuide(() => createProgram(deps), { packageRoot })).toEqual([])
})
