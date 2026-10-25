import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { describeProgram, flatten, parseCommandsDocument } from "@wirecat/cli-base/commands"
import { describe, expect, it, vi } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { useProfile } from "../scripts/testing/profile.js"
import { setConfig } from "./config.js"
import { checkCancelled } from "./errors.js"
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
    vi.spyOn(deps.tokens.options.keyring, "get").mockImplementation(() => {
      throw new Error("unexpected keyring")
    })
    deps.connectStore = async () => {
      throw new Error("unexpected database")
    }
    expect(await run(["commands", "--json"], deps)).toBe(0)
    const commands = flatten(JSON.parse(stdout[0] ?? "{}").commands)
    expect(commands.find((item) => item.path.join(" ") === "config set")).toMatchObject({
      origin: "handwritten",
      effects: { remote: "none", local: "write" },
      examples: ["zm config set files.timezone Europe/Madrid --json"],
    })
    expect(commands.find((item) => item.path.join(" ") === "search meetings")?.examples).toContain(
      'zm personal search meetings "example plan" --model e5-small --json',
    )
    expect(await run(["complete", "--", "search", "m"], deps)).toBe(0)
    expect(stdout[1]).toContain("meetings\t")
    expect(stdout[1]).toContain(":4\n")
    expect(await run(["--json", "complete", "--", "search", "m"], deps)).toBe(0)
    expect(JSON.parse(stdout[2] ?? "{}").items.some((item: { value: string }) => item.value === "meetings")).toBe(true)
    expect(stderr).toEqual([])
  })
  it("prints the shared commands document, whole and scoped", async () => {
    const { deps, stdout } = await setup()
    expect(await run(["commands", "--json"], deps)).toBe(0)
    expect(await run(["commands", "meetings", "show", "--json"], deps)).toBe(0)
    const [whole, scoped] = stdout.map((text) => parseCommandsDocument(JSON.parse(text)))
    expect(whole?.problems).toBeUndefined()
    expect(whole?.document).toMatchObject({ cli: "zm", contract: 3, exit_codes: { ok: 0 } })
    expect(scoped?.problems).toBeUndefined()
    expect(scoped?.document?.scope).toEqual(["meetings", "show"])
  })
  it("reports a crash as internal_error, with its record only under --debug", async () => {
    const { deps, stderr } = await setup()
    deps.data = () => {
      throw new Error("disk on fire")
    }
    expect(await run(["--json", "doctor"], deps)).toBe(1)
    expect(stderr).toHaveLength(1)
    expect(JSON.parse(stderr[0] ?? "{}").error.code).toBe("internal_error")
    expect(stderr[0]).not.toContain("disk on fire")
    expect(await run(["--json", "--debug", "doctor"], deps)).toBe(1)
    const [object, record] = (stderr[1] ?? "")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(object.error.code).toBe("internal_error")
    expect(record).toMatchObject({ command: "doctor", resource: { service: "zm" } })
    expect(JSON.stringify(record)).toContain("disk on fire")
  })
  it("says a failure in one line to a person at a terminal", async () => {
    const { deps, stderr } = await setup()
    deps.outputIsTTY = true
    expect(await run(["config", "set", "no.such.key", "x"], deps)).not.toBe(0)
    expect(stderr[0]).toMatch(/^✗ /)
  })
  it("lists a scoped group as text without --json", async () => {
    const { deps, stdout } = await setup()
    expect(await run(["commands", "config"], deps)).toBe(0)
    const text = stdout.join("")
    expect(text).toContain("zm config commands, by section.")
    expect(text).toMatch(/\nSet up\n {2}zm config show +show local configuration\n/)
    expect(text).toMatch(/ {2}zm config set <key> <value> +set a configuration value \(writes\)\n/)
  })
  it("reports keyring failure without reading a saved login or opening the database", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.client_id", "example-client")
    useProfile(deps.configPath, "example")
    vi.spyOn(deps.tokens.options.keyring, "get").mockImplementation(() => {
      throw new Error("unexpected keyring")
    })
    deps.connectStore = async () => {
      throw new Error("unexpected database")
    }
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}")).toMatchObject({
      profiles: ["example"],
      authentication: { configured: true, state: "not_checked", keyring: "unavailable" },
      database: "not_checked",
    })
  })
  it("tests only a disposable keyring entry and removes it after doctor", async () => {
    const { deps, stdout } = await setup()
    const keyring = memoryKeyring({ "example:example-client": "saved-login" })
    deps.tokens = new TokenManager({ ...deps.tokens.options, keyring })
    const get = vi.spyOn(keyring, "get")
    expect(await run(["doctor", "--json"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}")).toMatchObject({
      authentication: { keyring: "available", state: "not_checked" },
    })
    expect([...keyring.entries.values()]).toEqual(["saved-login"])
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/^zoom-cli-doctor:/), "probe")
    expect(get).toHaveBeenCalledTimes(1)
  })
  it("lists every config problem in doctor, without values, and doctor is clean once each fix has run", async () => {
    const { deps, stdout, stderr } = await setup()
    await writeFile(
      deps.configPath,
      JSON.stringify({
        clientId: "example-secret-client",
        source: "api",
        account_profile: "example",
        files_timezone: "Example/Nowhere",
        profiles: { work: { permissions: { "example.nothing": "deny" } } },
      }),
    )
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    const { config } = readAnswer(stdout.at(-1) ?? "{}") as { config: { issues: { fix?: string }[] } }
    expect(config).toEqual({
      path: deps.configPath,
      found: true,
      issues: [
        {
          kind: "invalid_value",
          file: deps.configPath,
          key: "files.timezone",
          what: "setting files.timezone has to be an IANA time zone, such as Europe/Madrid",
          fix: "zm config unset files.timezone",
        },
        {
          kind: "unknown_setting",
          file: deps.configPath,
          key: "clientId",
          what: "setting clientId is not a setting of zm",
          fix: "zm config unset clientId",
        },
        {
          kind: "unknown_setting",
          file: deps.configPath,
          key: "account_profile",
          what: "setting account_profile is not a setting of zm",
          fix: "zm config unset account_profile",
        },
        {
          kind: "unknown_permission",
          file: deps.configPath,
          profile: "work",
          key: "permissions.example.nothing",
          what: "permissions.example.nothing names no command",
          fix: "zm work config unset permissions.example.nothing",
        },
      ],
    })
    expect(await run(["--json", "work", "meetings", "list"], deps)).toBe(3)
    expect(JSON.parse(stderr.at(-1) ?? "{}").error).toMatchObject({
      code: "configuration_error",
      message:
        `${deps.configPath}: setting files.timezone has to be an IANA time zone, such as Europe/Madrid — remove it ` +
        "with `zm config unset files.timezone`" +
        " (and 3 more problems — `zm doctor` lists them all)",
    })
    expect(await run(["--json", "config", "show"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({ source: "api", profiles: ["work"] })
    expect(stderr.join("")).toContain(
      "setting account_profile is not a setting of zm, so it is left out — `zm config unset account_profile` removes it",
    )
    for (const { fix } of config.issues) expect(await run((fix ?? "").split(" ").slice(1), deps)).toBe(0)
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({ config: { issues: [] }, profiles: ["work"] })
    expect(JSON.parse(await readFile(deps.configPath, "utf8"))).toEqual({ source: "api", profiles: { work: {} } })
    expect([...stdout, ...stderr].join("")).not.toContain("example-secret-client")
  })
  it("reports where broken JSON stops parsing, with no fix, and still answers", async () => {
    const { deps, stdout } = await setup()
    await writeFile(deps.configPath, '{\n  "source": "api",\n  oops\n}\n')
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({
      config: {
        found: true,
        issues: [
          {
            kind: "invalid_json",
            file: deps.configPath,
            line: 3,
            column: 3,
            what: "the file is not valid JSON at line 3, column 3",
          },
        ],
      },
      profiles: [],
    })
  })
  it("inspects cached OAuth status without refresh and keeps local profiles distinct", async () => {
    const { deps, stdout, stderr } = await setup()
    expect(await run(["--json", "session", "status"], deps)).toBe(2)
    expect(JSON.parse(stderr.at(-1) ?? "{}").error).toMatchObject({
      code: "validation_error",
      details: { profiles: [] },
    })
    expect(await run(["local-example", "--json", "session", "status"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({
      configured: false,
      state: "not_configured",
      profile: "local-example",
    })
    setConfig(deps.configPath, "zoom.client_id", "example-client")
    useProfile(deps.configPath, "local-example")
    expect(await run(["--json", "session", "status"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}").state).toBe("missing")
    deps.tokens.forProfile("local-example").save({
      accessToken: "example-access-secret",
      refreshToken: "example-refresh-secret",
      expiresAt: 1000,
      scopes: ["example:read"],
    })
    expect(await run(["--json", "session", "status"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({
      state: "saved",
      verified: false,
      profile: "local-example",
      scopes: ["example:read"],
    })
    expect(await run(["other-example", "--json", "session", "status"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({ state: "missing", profile: "other-example" })
    deps.now = () => 1000
    expect(await run(["--json", "session", "status"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}").state).toBe("expired")
    expect(stdout.join("")).not.toContain("example-access-secret")
    expect(stdout.join("")).not.toContain("example-refresh-secret")
    deps.tokens
      .forProfile("local-example")
      .save({ accessToken: "example", refreshToken: "example", expiresAt: 3600000, scopes: ["example:read"] })
    expect(await run(["--json", "session", "status", "--check"], deps)).toBe(3)
    deps.checkSession = async () => ({ id: "example-user" })
    expect(await run(["--json", "session", "status", "--check"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({
      state: "verified",
      verified: true,
      profile: "local-example",
      zoom_user: { id: "example-user" },
    })
  })
  it("uses shared errors and exit mappings without private generic details", async () => {
    expect(new CliError("rate_limited", "example")).toBeInstanceOf(CliError)
    const { deps, stderr } = await setup()
    setConfig(deps.configPath, "zoom.client_id", "example-client")
    useProfile(deps.configPath)
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
  it("names the real option for a bad --pause", async () => {
    const { deps, stderr } = await setup()
    expect(await run(["watch", "files", ".", "--pause", "0s", "--jsonl"], deps)).toBe(2)
    expect(JSON.parse(stderr.at(-1) ?? "{}").error.message).toContain("--pause has to be more than zero")
  })
  it("refuses login in CI or with --no-input, before opening a browser", async () => {
    const { deps, stdout, stderr } = await setup()
    const message = () => JSON.parse(stderr.at(-1) ?? "{}").error.message
    setConfig(deps.configPath, "zoom.client_id", "example-client")
    deps.env = { CI: "1" }
    expect(await run(["example", "session", "start"], deps)).toBe(3)
    expect(message()).toContain("run zm example session start yourself")
    deps.env = {}
    expect(await run(["--no-input", "example", "session", "start"], deps)).toBe(3)
    expect(message()).toContain("remove --no-input")
    expect(stdout).toEqual([])
    const program = createProgram(deps)
    expect(
      describeProgram(program)
        .find((cmd) => cmd.name === "session")
        ?.commands.find((cmd) => cmd.name === "start")?.effects,
    ).toEqual({ remote: "write", local: "write" })
  })
  it("uses shared human rendering only for terminal output", async () => {
    const { deps, stdout } = await setup()
    deps.outputIsTTY = true
    expect(await run(["--quiet", "doctor"], deps)).toBe(0)
    expect(stdout[0]).toContain("version")
    expect(() => JSON.parse(stdout[0] ?? "{}")).toThrow()
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout[1] ?? "{}")).toHaveProperty("version")
  })
})

it("quiet keeps the login URL, the one thing an agent can pass on, and the failure envelope", async () => {
  const { deps, stdout, stderr } = await setup()
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  expect(await run(["example", "--quiet", "session", "start"], deps)).toBe(3)
  expect(stdout).toEqual([])
  expect(stderr).toHaveLength(2)
  expect(stderr[0]).toContain("Open this URL to approve Zoom login:")
  expect(JSON.parse(stderr[1] ?? "{}").error.code).toBe("configuration_error")
})

it.each(["set", "get", "delete"] as const)(
  "doctor reports unavailable when keyring %s fails and suppresses raw errors",
  async (operation) => {
    const { deps, stdout, stderr } = await setup()
    vi.spyOn(deps.tokens.options.keyring, operation).mockImplementation(() => {
      throw new Error("invented-private-diagnostic")
    })
    expect(await run(["doctor", "--json"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}")).toMatchObject({ authentication: { keyring: "unavailable" } })
    expect([...stdout, ...stderr].join("")).not.toContain("invented-private-diagnostic")
  },
)

it("declares source-owned lists honestly and refuses unsupported filters before accessing their source", async () => {
  const { deps, stdout, stderr } = await setup()
  for (const path of [
    ["recordings", "list"],
    ["remote-meetings", "list"],
    ["recordings", "schedule", "list"],
  ]) {
    expect(await run([...path, "id:fixture", "--json"], deps)).toBe(2)
    const error = JSON.parse(stderr.pop() ?? "{}").error
    expect(error.code).toBe("validation_error")
    expect(error.message).toContain("id")
    expect(stdout).toEqual([])
  }
})
