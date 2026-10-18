import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { afterEach, expect, it, vi } from "vitest"
import { type ProgramDeps, run } from "./program.js"
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
