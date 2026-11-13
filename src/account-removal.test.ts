import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { addProfile, readConfig, setConfig } from "./config.js"
import { legacyLoginService, zmPaths } from "./folders.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const CLIENT = "example-client"

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "zm-home-"))
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: process.env.PATH }
  const paths = zmPaths({ env })
  mkdirSync(paths.config, { recursive: true })
  const configPath = join(paths.config, "config.json")
  const keyring = memoryKeyring()
  const tokens = new TokenManager({
    clientId: CLIENT,
    keyring,
    service: "zoom-cli",
    configDir: paths.config,
    legacyService: legacyLoginService({ env }),
    fetch: async () => new Response("{}"),
  })
  setConfig(configPath, "zoom.client_id", CLIENT)
  const stdout: string[] = []
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath,
    tokens,
    fetch: async () => new Response("{}"),
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
    env,
  }
  const signIn = (profile: string) => {
    addProfile(configPath, profile)
    keyring.set(
      legacyLoginService({ env }),
      `${CLIENT}:${profile}`,
      JSON.stringify({ accessToken: "a", refreshToken: "r", expiresAt: 1, scopes: [] }),
    )
    mkdirSync(join(paths.state, "checkpoints", profile), { recursive: true })
    writeFileSync(join(paths.state, "checkpoints", profile, "meetings.json"), "{}")
  }
  signIn("personal")
  signIn("work")
  const call = async (...args: string[]) => {
    stdout.length = 0
    stderr.length = 0
    const code = await run(args, deps)
    const out = stdout.join("")
    return {
      code,
      item: out ? JSON.parse(out).item : undefined,
      error: stderr.join("").startsWith("{") ? JSON.parse(stderr.join("")).error : undefined,
    }
  }
  const loggedIn = (store: KeyringStore, profile: string) =>
    store.get("zoom-cli", `oauth:zoom:${profile}`) !== null ||
    store.get(legacyLoginService({ env }), `${CLIENT}:${profile}`) !== null
  const checkpoints = (profile: string) => existsSync(join(paths.state, "checkpoints", profile))
  return { paths, configPath, keyring, call, loggedIn: (profile: string) => loggedIn(keyring, profile), checkpoints }
}

describe("zm session end", () => {
  it("deletes this profile's login only, and says nothing was there the second time", async () => {
    const t = setup()
    expect((await t.call("--json", "personal", "session", "end")).item).toEqual({
      profile: "personal",
      ended: true,
      meetings: "retained",
    })
    expect(t.loggedIn("personal")).toBe(false)
    expect(t.loggedIn("work")).toBe(true)
    expect((await t.call("--json", "personal", "session", "end")).item).toMatchObject({ ended: false })
  })
})

describe("zm account remove", () => {
  it("refuses to choose what happens to the data", async () => {
    const t = setup()
    const { error } = await t.call("--json", "personal", "account", "remove", "--yes")
    expect(error).toMatchObject({ reason: "account-remove.no-choice" })
    expect(t.loggedIn("personal")).toBe(true)
  })

  it("forgets the login, the profile and its checkpoints, and leaves the other profile alone", async () => {
    const t = setup()
    const { code, item } = await t.call("--json", "personal", "account", "remove", "--keep-data", "--yes")

    expect(code).toBe(0)
    expect(item.account).toEqual({ provider: "zoom", account: "zm-profile:personal" })
    expect(item.revoked).toBeNull()
    expect(item.kept).toContainEqual(expect.objectContaining({ kind: "store", target: "zoom:zm-profile:personal" }))
    expect(t.loggedIn("personal")).toBe(false)
    expect(readConfig(t.configPath).profiles).toEqual(["work"])
    expect(t.checkpoints("personal")).toBe(false)

    expect(t.loggedIn("work")).toBe(true)
    expect(t.checkpoints("work")).toBe(true)
  })

  it("lists the same removal under --delete-data without touching other profiles", async () => {
    const t = setup()
    const { code } = await t.call("--json", "personal", "account", "remove", "--delete-data", "--yes")

    expect(code).toBe(0)
    expect(t.loggedIn("personal")).toBe(false)
    expect(t.loggedIn("work")).toBe(true)
    expect(readConfig(t.configPath).profiles).toEqual(["work"])
  })

  it("previews with --dry-run and removes nothing", async () => {
    const t = setup()
    const { item } = await t.call("--json", "personal", "account", "remove", "--delete-data", "--dry-run")

    expect(item).toMatchObject({ dry_run: true })
    expect(item.removed).toContainEqual({ kind: "config", target: "profiles.personal" })
    expect(t.loggedIn("personal")).toBe(true)
    expect(readConfig(t.configPath).profiles).toEqual(["personal", "work"])
  })

  it("succeeds for a profile that is already signed out", async () => {
    const t = setup()
    await t.call("--json", "personal", "session", "end")

    const { code, error } = await t.call("--json", "personal", "account", "remove", "--keep-data", "--yes")

    expect(error).toBeUndefined()
    expect(code).toBe(0)
    expect(readConfig(t.configPath).profiles).toEqual(["work"])
  })

  it("refuses while an archive schedule still runs for the profile, and goes ahead once it is disabled", async () => {
    const t = setup()
    const id = "a".repeat(64)
    const directory = join(t.paths.config, "recording-schedules")
    mkdirSync(directory, { recursive: true })
    const job = (state: string) => JSON.stringify({ capture: { profile: "personal" }, state })
    writeFileSync(join(directory, `${id}.json`), job("enabled"))

    const refused = await t.call("--json", "personal", "account", "remove", "--keep-data", "--yes")
    expect(refused.error).toMatchObject({ reason: "account-remove.busy" })
    expect(t.loggedIn("personal")).toBe(true)

    writeFileSync(join(directory, `${id}.json`), job("disabled"))
    expect((await t.call("--json", "personal", "account", "remove", "--keep-data", "--yes")).code).toBe(0)
  })
})
