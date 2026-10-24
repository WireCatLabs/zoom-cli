import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { memoryKeyring } from "@wirecat/cli-base"
import { checkStep, commandWords, liftProfile, loadScenarios, shellProblems } from "@wirecat/cli-core/cli"
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
    [["remote-meetings", "create", "--title", "Example", "--yes"], "change Zoom"],
    [["remote-meetings", "cancel", "123456789", "--yes"], "change Zoom"],
    [["session", "start"], "log in or out"],
    [["meetings", "import", "./downloaded"], "outside a sync"],
    [["meetings", "link", "1", "--participant-id", "1", "--person", "p1", "--yes"], "outside a sync"],
    [["meetings", "embeddings", "--model", "e5-small", "--yes"], "embedding service"],
    [["config", "set", "files.timezone", "UTC"], "outside a sync"],
    [["skill", "install"], "outside a sync"],
    [
      [
        ...["recordings", "schedule", "create", "--name", "daily", "--output-dir", "/tmp/zm-archive"],
        ...["--since-time", "2026-01-01", "--at", "03:00", "--timezone", "Europe/Madrid", "--yes"],
      ],
      "outside a sync",
    ],
    [["search", "meetings", "budget", "--model", "e5-small"], "embedding service"],
  ])("refuses %j with exit 5 before any network or store call", async (args, what) => {
    const { deps, network, stderr } = await setup({ ZM_READ_ONLY: "1" })
    expect(await run([...args, "--json"], deps)).toBe(5)
    expect(stderr.join("")).toContain("this process is read-only (ZM_READ_ONLY)")
    if (what === "outside a sync") expect(stderr.join("")).toMatch(/message store|what a later run may do/)
    else expect(stderr.join("")).toContain(what)
    expect(network).not.toHaveBeenCalled()
    expect(deps.connectStore).not.toHaveBeenCalled()
  })

  it.each([
    [["meetings", "sync", "--json"]],
    [["recordings", "download", "123456789", "--output-dir", "/tmp/zm-archive", "--json"]],
    [["recordings", "download", "--since-time", "2026-01-01", "--output-dir", "/tmp/zm-archive", "--json"]],
    [["watch", "api", "--jsonl"]],
  ])("lets the mirroring sync %j run", async (args) => {
    const { deps, stderr } = await setup({ ZM_READ_ONLY: "1" })
    expect(await run(args, deps)).not.toBe(5)
    expect(stderr.join("")).not.toContain("read-only")
  })

  it("lets reads through, word search and its index included", async () => {
    const { deps, stderr } = await setup({ ZM_READ_ONLY: "1" })
    expect(await run(["doctor", "--json"], deps)).toBe(0)
    expect(await run(["search", "meetings", "budget", "--json"], deps)).not.toBe(5)
    expect(stderr.join("")).not.toContain("read-only")
  })

  it("is off when set to 0", async () => {
    const { deps, stderr } = await setup({ ZM_READ_ONLY: "0" })
    await run(["config", "set", "files.timezone", "UTC", "--json"], deps)
    expect(stderr.join("")).not.toContain("read-only")
  })
})

it("keeps every scenario step runnable", async () => {
  const { deps } = await setup({})
  const { scenarios, problems } = await loadScenarios(fileURLToPath(new URL("../scenarios", import.meta.url)))
  expect(problems).toEqual([])
  expect(scenarios).toHaveLength(5)
  for (const scenario of scenarios) {
    for (const step of scenario.steps) {
      const program = createProgram(deps)
      const words = step.run.split(/\s+/)
      const lifted = liftProfile(words.slice(1), commandWords(program))
      expect(lifted.profile, step.run).toBe("personal")
      expect(shellProblems(step.run), step.run).toEqual([])
      expect(checkStep(program, step.run.replace(/^zm personal /, "zm ")), step.run).toEqual([])
    }
  }
})
