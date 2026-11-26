import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { describeProgram, flatten, parseCommandsDocument } from "@wirecat/cli-base/commands"
import { ownCatalogue } from "@wirecat/cli-core/testing"
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
      service: "zoom-cli",
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
  it("reports the profiles and the sign-in client without touching the keyring or the database", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.client_id", "example-client")
    useProfile(deps.configPath, "example")
    const keyring = deps.tokens.options.keyring
    const touched = [vi.spyOn(keyring, "get"), vi.spyOn(keyring, "set"), vi.spyOn(keyring, "delete")]
    deps.connectStore = async () => {
      throw new Error("unexpected database")
    }
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}")).toMatchObject({
      profiles: ["example"],
      oauth_client: { client: "own", source: "config" },
      store: { exists: expect.any(Boolean) },
    })
    for (const spy of touched) expect(spy).not.toHaveBeenCalled()
  })
  it("says in doctor that WireCat has no Zoom app when nothing names one", async () => {
    const { deps, stdout } = await setup()
    deps.env = {}
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}").oauth_client).toEqual({
      client: null,
      source: null,
      reason:
        "WireCat has no Zoom app yet; make your own (docs/zoom-app.md) and set zoom.client_id or ZM_ZOOM_CLIENT_ID",
    })
  })
  it("reports ZM_ZOOM_CLIENT_ID in doctor over the configured client id", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.client_id", "example-client")
    deps.env = { ZM_ZOOM_CLIENT_ID: "example-env-client" }
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}").oauth_client).toEqual({ client: "own", source: "env" })
  })
  it("lists every config problem in doctor, without values, and doctor is clean once each fix has run", async () => {
    const { deps, stdout, stderr } = await setup()
    await writeFile(
      deps.configPath,
      JSON.stringify({
        example_id: "example-secret-client",
        source: "api",
        example_setting: "example",
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
          key: "example_id",
          what: "setting example_id is not a setting of zm",
          fix: "zm config unset example_id",
        },
        {
          kind: "unknown_setting",
          file: deps.configPath,
          key: "example_setting",
          what: "setting example_setting is not a setting of zm",
          fix: "zm config unset example_setting",
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
      "setting example_setting is not a setting of zm, so it is left out — `zm config unset example_setting` removes it",
    )
    for (const { fix } of config.issues) expect(await run((fix ?? "").split(" ").slice(1), deps)).toBe(0)
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({ config: { issues: [] }, profiles: ["work"] })
    const fixed = JSON.parse(await readFile(deps.configPath, "utf8"))
    expect(fixed.profiles).toEqual({ work: {} })
    for (const gone of ["example_id", "example_setting", "files_timezone"]) expect(fixed).not.toHaveProperty(gone)
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
  it.skipIf(process.platform === "win32")(
    "reports a config file and folder others can read, with the chmod that fixes each",
    async () => {
      const { deps, stdout, stderr } = await setup()
      const folder = dirname(deps.configPath)
      await writeFile(deps.configPath, JSON.stringify({ source: "api" }))
      await chmod(deps.configPath, 0o644)
      await chmod(folder, 0o775)
      expect(await run(["--json", "doctor"], deps)).toBe(0)
      expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({
        config: { issues: [] },
        files: {
          checked: true,
          ok: false,
          problems: [
            { path: deps.configPath, mode: "0644", want: "0600" },
            { path: folder, mode: "0775", want: "0700" },
          ],
        },
      })
      const fixes = stderr.map((line) => line.trimEnd()).filter((line) => line.startsWith("to make it private: "))
      expect(fixes).toEqual([
        `to make it private: chmod 600 '${deps.configPath}'`,
        `to make it private: chmod 700 '${folder}'`,
      ])
      for (const fix of fixes) execFileSync("sh", ["-c", fix.slice("to make it private: ".length)])
      expect(await run(["--json", "doctor"], deps)).toBe(0)
      expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({ files: { checked: true, ok: true, problems: [] } })
      await chmod(deps.configPath, 0o644)
      expect(await run(["config", "set", "source", "files"], deps)).toBe(0)
      expect(statSync(deps.configPath).mode & 0o777).toBe(0o600)
    },
  )
  it("answers when the config path is a folder, naming it as the problem", async () => {
    const { deps, stdout } = await setup()
    await mkdir(deps.configPath)
    expect(await run(["--json", "doctor"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({
      config: {
        found: true,
        issues: [{ kind: "invalid_value", file: deps.configPath, what: "the path is a folder, not a file" }],
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
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({ state: "missing", profile: "local-example" })
    setConfig(deps.configPath, "zoom.client_id", "example-client")
    useProfile(deps.configPath, "local-example")
    const expiresAt = Date.now() + 3600_000
    deps.tokens.forProfile("local-example").save({
      accessToken: "example-access-secret",
      refreshToken: "example-refresh-secret",
      expiresAt,
      scopes: ["user:read:user"],
    })
    expect(await run(["--json", "session", "status"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({
      state: "saved",
      verified: false,
      profile: "local-example",
      scopes: ["user:read:user"],
      expires_at: new Date(expiresAt).toISOString(),
    })
    expect(await run(["other-example", "--json", "session", "status"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({ state: "missing", profile: "other-example" })
    deps.fetch = async () => new Response(JSON.stringify({ id: "example-user", email: "user@example.com" }))
    expect(await run(["--json", "session", "status", "--check"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "{}")).toMatchObject({
      state: "saved",
      verified: true,
      profile: "local-example",
      user_id: "example-user",
    })
    expect(stdout.join("")).not.toContain("example-access-secret")
    expect(stdout.join("")).not.toContain("example-refresh-secret")
  })
  it("uses shared errors and exit mappings without private generic details", async () => {
    expect(new CliError("rate_limited", "example")).toBeInstanceOf(CliError)
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
  it("declares session start a remote and local write", async () => {
    const { deps } = await setup()
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
  deps.openBrowser = async (url) => {
    const state = new URL(url).searchParams.get("state") ?? ""
    await fetch(
      `http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, error: "access_denied" })}`,
    )
  }
  expect(await run(["example", "--quiet", "session", "start"], deps)).not.toBe(0)
  expect(stdout).toEqual([])
  expect(stderr.join("")).toContain("Open Zoom sign-in: https://zoom.us/oauth/authorize?")
  expect(JSON.parse(stderr.at(-1) ?? "{}").error.code).toBe("authentication_error")
})

it("declares source-owned lists honestly and refuses unsupported filters before accessing their source", async () => {
  const { deps, stdout, stderr } = await setup()
  for (const path of [
    ["recordings", "list"],
    ["recordings", "schedule", "list"],
  ]) {
    expect(await run([...path, "id:fixture", "--json"], deps)).toBe(2)
    const error = JSON.parse(stderr.pop() ?? "{}").error
    expect(error.code).toBe("validation_error")
    expect(error.message).toContain("id")
    expect(stdout).toEqual([])
  }
})

it("pins only zm's own commands as MCP reads and writes; cli-core pins what it mounts (IDEA-288)", async () => {
  const { deps } = await setup()
  await expect(`${JSON.stringify(ownCatalogue(createProgram(deps)), null, 2)}\n`).toMatchFileSnapshot(
    "../contracts/own-catalogue.json",
  )
})
