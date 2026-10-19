import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { describeProgram, flatten } from "@wirecat/cli-base/commands"
import { afterEach, expect, it, vi } from "vitest"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const unavailable = async (): Promise<never> => {
  throw new Error("unexpected IO")
}
const setup = () => {
  const stdout: string[] = []
  const deps: ProgramDeps = {
    configPath: join(tmpdir(), "zm-test-first-screen", "config.json"),
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: memoryKeyring(),
      service: "example",
      fetch: unavailable,
    }),
    fetch: unavailable,
    openBrowser: unavailable,
    data: (text) => stdout.push(text),
    diagnostic: () => {},
  }
  return { deps, stdout }
}

afterEach(() => {
  vi.restoreAllMocks()
})

it("shows the first screen on --help and the full help on --help-all", async () => {
  const { deps, stdout } = setup()
  expect(await run(["--help"], deps)).toBe(0)
  expect(stdout.join("")).toContain('search meetings "quote"')
  expect(stdout.join("")).not.toContain("remote-meetings")
  stdout.length = 0
  expect(await run(["--help-all"], deps)).toBe(0)
  expect(stdout.join("")).toContain("remote-meetings")
})

it("prints the options for every command", async () => {
  const { deps, stdout } = setup()
  expect(await run(["help", "options"], deps)).toBe(0)
  expect(stdout.join("")).toContain("--offline")
})

it("prints a scenario's steps", async () => {
  const { deps } = setup()
  const written: string[] = []
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk))
    return true
  })
  expect(await run(["guide", "find-quote"], deps)).toBe(0)
  expect(written.join("")).toContain("zm meetings passage")
})

it("prints help for every command, lists with a query included", async () => {
  const { deps } = setup()
  const leaves = flatten(describeProgram(createProgram(deps))).filter((command) => command.commands.length === 0)
  const failed: string[] = []
  for (const { path } of leaves) if ((await run([...path, "--help"], deps)) !== 0) failed.push(path.join(" "))
  expect(leaves.length).toBeGreaterThan(50)
  expect(failed).toEqual([])
})

it("lists commands as text by section, and as JSON with --json", async () => {
  const { deps, stdout } = setup()
  expect(await run(["commands"], deps)).toBe(0)
  const text = stdout.join("")
  expect(text).toMatch(/\nWrite\n {2}zm meetings transcribe/)
  expect(text).toMatch(/\nAutomate\n {2}zm recordings schedule create/)
  expect(text).toContain("zm session start [options]")
  stdout.length = 0
  expect(await run(["commands", "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).contract).toBe(3)
})
