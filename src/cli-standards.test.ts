import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-core"
import { describeProgram, flatten } from "@wirecat/cli-core/commands"
import { describe, expect, it } from "vitest"
import { setConfig } from "./config.js"
import { checkCancelled, ZoomError } from "./errors.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const configPath = join(await mkdtemp(join(tmpdir(), "zm-test-standards-")), "config.json")
  const stdout: string[] = []
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath,
    tokens: new TokenManager({
      clientId: "example-client",
      service: "example",
      keyring: memoryKeyring(),
      now: () => 0,
      fetch: async () => {
        throw new Error("unexpected network")
      },
    }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
    now: () => 0,
  }
  return { deps, stdout, stderr }
}

describe("portable CLI discovery and diagnostics", () => {
  it("discovers commands and completion without loading even corrupt config", async () => {
    const { deps, stdout, stderr } = await setup()
    await writeFile(deps.configPath, "broken")
    deps.tokens.load = () => {
      throw new Error("unexpected keyring")
    }
    deps.connectStore = async () => {
      throw new Error("unexpected database")
    }
    expect(await run(["commands", "--json"], deps)).toBe(0)
    const commands = flatten(JSON.parse(stdout[0] ?? "{}").commands)
    expect(commands.find((item) => item.path.join(" ") === "config set")).toMatchObject({
      origin: "handwritten",
      mutates: true,
      local: true,
      examples: ["zm config set account.profile personal --json"],
    })
    expect(commands.find((item) => item.path.join(" ") === "meetings search")?.examples).toEqual([
      'zm meetings search "example plan" --json',
    ])
    expect(await run(["complete", "--", "meetings", "s"], deps)).toBe(0)
    expect(stdout[1]).toContain("search\t")
    expect(stdout[1]).toContain(":4\n")
    expect(await run(["--json", "complete", "--", "meetings", "s"], deps)).toBe(0)
    expect(JSON.parse(stdout[2] ?? "{}").items.some((item: { value: string }) => item.value === "search")).toBe(true)
    expect(stderr).toEqual([])
  })
  it("reports local health and explicitly unknown authentication without keyring/DB access", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    setConfig(deps.configPath, "account.profile", "example")
    deps.tokens.load = () => {
      throw new Error("unexpected keyring")
    }
    deps.connectStore = async () => {
      throw new Error("unexpected database")
    }
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      dataProfile: "example",
      authentication: { configured: true, state: "not_checked" },
      database: "not_checked",
    })
  })
  it("inspects cached OAuth status without refresh and keeps local profiles distinct", async () => {
    const { deps, stdout } = await setup()
    expect(await run(["--json", "session", "status"], deps)).toBe(0)
    expect(JSON.parse(stdout.at(-1) ?? "{}")).toMatchObject({ configured: false, state: "not_configured" })
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    setConfig(deps.configPath, "account.profile", "local-example")
    expect(await run(["--json", "session", "status"], deps)).toBe(0)
    expect(JSON.parse(stdout.at(-1) ?? "{}").state).toBe("missing")
    deps.tokens.save({
      accessToken: "example-access-secret",
      refreshToken: "example-refresh-secret",
      expiresAt: 1000,
      scopes: ["example:read"],
    })
    expect(await run(["--json", "session", "status"], deps)).toBe(0)
    expect(JSON.parse(stdout.at(-1) ?? "{}")).toMatchObject({
      state: "saved",
      verified: false,
      dataProfile: "local-example",
      scopes: ["example:read"],
    })
    deps.now = () => 1000
    expect(await run(["--json", "session", "status"], deps)).toBe(0)
    expect(JSON.parse(stdout.at(-1) ?? "{}").state).toBe("expired")
    expect(stdout.join("")).not.toContain("example-access-secret")
    expect(stdout.join("")).not.toContain("example-refresh-secret")
    deps.tokens.save({ accessToken: "example", refreshToken: "example", expiresAt: 3600000, scopes: ["example:read"] })
    expect(await run(["--json", "session", "status", "--check"], deps)).toBe(3)
    deps.checkSession = async () => ({ id: "example-user" })
    expect(await run(["--json", "session", "status", "--check"], deps)).toBe(0)
    expect(JSON.parse(stdout.at(-1) ?? "{}")).toMatchObject({
      state: "verified",
      verified: true,
      profile: { id: "example-user" },
    })
  })
  it("uses shared errors and exit mappings without private generic details", async () => {
    expect(new ZoomError("rate_limited", "example")).toBeInstanceOf(CliError)
    const { deps, stderr } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    for (const [code, exit] of [
      ["rate_limited", 8],
      ["timeout", 9],
      ["network_error", 10],
      ["permission_error", 5],
      ["cancelled", 130],
    ] as const) {
      deps.checkSession = async () => {
        throw new CliError(code, "example diagnostic")
      }
      expect(await run(["session", "status", "--check"], deps)).toBe(exit)
      expect(JSON.parse(stderr.at(-1) ?? "{}").error.code).toBe(code)
    }
    const controller = new AbortController()
    controller.abort("private cancellation reason")
    expect(() => checkCancelled(controller.signal)).toThrow("command cancelled")
    const timedOut = new AbortController()
    timedOut.abort(new DOMException("private", "TimeoutError"))
    expect(() => checkCancelled(timedOut.signal)).toThrow("command timed out")
    const typed = new AbortController()
    typed.abort(new CliError("timeout", "example deadline"))
    expect(() => checkCancelled(typed.signal)).toThrow("example deadline")
    checkCancelled()
  })
  it("rejects real headless/CI/machine login before opening a browser", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    deps.interactive = false
    expect(await run(["--interactive", "login"], deps)).toBe(3)
    deps.interactive = true
    deps.env = { CI: "1" }
    expect(await run(["login"], deps)).toBe(3)
    deps.env = {}
    expect(await run(["--json", "login"], deps)).toBe(3)
    deps.outputIsTTY = false
    expect(await run(["login"], deps)).toBe(3)
    expect(stdout).toEqual([])
    const program = createProgram(deps)
    expect(describeProgram(program).find((cmd) => cmd.name === "login")?.mutates).toBe(true)
  })
  it("uses shared human rendering only for terminal output", async () => {
    const { deps, stdout } = await setup()
    deps.outputIsTTY = true
    expect(await run(["--quiet", "doctor"], deps)).toBe(0)
    expect(stdout[0]).toContain("version")
    expect(() => JSON.parse(stdout[0] ?? "{}")).toThrow()
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(JSON.parse(stdout[1] ?? "{}")).toHaveProperty("version")
  })
})

it("quiet suppresses optional login instructions but retains the failure envelope", async () => {
  const { deps, stdout, stderr } = await setup()
  setConfig(deps.configPath, "zoom.clientId", "example-client")
  expect(await run(["--quiet", "login"], deps)).toBe(3)
  expect(stdout).toEqual([])
  expect(stderr).toHaveLength(1)
  expect(JSON.parse(stderr[0] ?? "{}").error.code).toBe("configuration_error")
})
