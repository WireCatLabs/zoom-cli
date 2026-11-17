import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brokenKeyring } from "@wirecat/cli-base"
import { expect, it, vi } from "vitest"
import { useProfile } from "../scripts/testing/profile.js"
import { setConfig } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-keyring-"))
  const stdout: string[] = []
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: brokenKeyring("Platform failure: DBus error: Failed to connect to socket"),
      service: "example",
      configDir: directory,
      fetch: async () => new Response(),
    }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
  }
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  useProfile(deps.configPath, "personal")
  return { deps, stdout, stderr }
}
const failure = (rows: string[]) => JSON.parse(rows.join("")).error

it("with no keyring and no sign-in file, session status, end and account remove name the unreachable keyring", async () => {
  const { deps, stdout, stderr } = await setup()
  const warnings = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  for (const args of [
    ["session", "status", "--json"],
    ["session", "end", "--json"],
    ["account", "remove", "--keep-data", "--yes", "--json"],
  ]) {
    stdout.length = 0
    stderr.length = 0
    expect(await run(args, deps), args.join(" ")).not.toBe(0)
    expect(stdout, args.join(" ")).toEqual([])
    expect(failure(stderr), args.join(" ")).toMatchObject({ reason: "keyring.unreachable" })
    expect(failure(stderr).message).toContain("log out and back in")
  }
  warnings.mockRestore()
})
