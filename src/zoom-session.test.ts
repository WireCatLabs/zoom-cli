import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { addProfile, readConfig, setConfig } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const NOW = Date.UTC(2030, 0, 1)
const entry = (expiresAt: number) =>
  JSON.stringify({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt,
    scopes: ["user:read:user"],
  })

const setup = (keyring: KeyringStore = memoryKeyring()) => {
  const root = mkdtempSync(join(tmpdir(), "zm-test-session-"))
  const config = join(root, "config")
  const env: NodeJS.ProcessEnv = { ZM_CONFIG_DIR: config, ZM_STATE_DIR: join(root, "state") }
  const stdout: string[] = []
  const stderr: string[] = []
  const tokenRequests: string[] = []
  const zoomRequests: string[] = []
  const deps: ProgramDeps = {
    configPath: join(config, "config.json"),
    env,
    tokens: new TokenManager({
      clientId: "example-client",
      keyring,
      service: "zoom-cli",
      fetch: async () => new Response(),
    }),
    signInFetch: async (url) => {
      tokenRequests.push(String(url))
      return Response.json({ access_token: "example-new", refresh_token: "example-rotated", expires_in: 3600 })
    },
    fetch: async (url) => {
      zoomRequests.push(String(url))
      return Response.json({ id: "example-user", email: "user@example.com", display_name: "Example User" })
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
    now: () => NOW,
  }
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  const error = () => JSON.parse(stderr.at(-1) ?? "{}").error
  return { deps, env, keyring, stdout, stderr, error, tokenRequests, zoomRequests }
}

describe("zm session on cli-core's oauthSessionCommand", () => {
  it("acts for no profile nobody named, and lists the ones here", async () => {
    const { deps, error } = setup()
    addProfile(deps.configPath, "work")
    addProfile(deps.configPath, "home")
    for (const command of ["start", "status", "end"]) {
      expect(await run(["--json", "session", command], deps)).toBe(2)
      expect(error()).toMatchObject({ code: "validation_error", details: { profiles: ["home", "work"] } })
    }
  })

  it("refuses another profile than the locked one", async () => {
    const { deps, env, error } = setup()
    env.ZM_PROFILE_LOCK = "work"
    expect(await run(["--json", "home", "session", "status"], deps)).not.toBe(0)
    expect(error()).toMatchObject({ code: "permission_error" })
  })

  it("reads a sign-in zm kept before, with no new sign-in", async () => {
    const { deps, keyring, stdout, tokenRequests, zoomRequests } = setup()
    keyring.set("zoom-cli", "oauth:zoom:work", entry(NOW + 3600_000))
    expect(await run(["--json", "work", "session", "status", "--check"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "")).toMatchObject({
      profile: "work",
      state: "saved",
      verified: true,
      expires_at: new Date(NOW + 3600_000).toISOString(),
      email: "user@example.com",
    })
    expect(tokenRequests).toEqual([])
    expect(zoomRequests).toEqual(["https://api.zoom.us/v2/users/me"])
  })

  it("reads a sign-in under an older version's per-folder service", async () => {
    const { deps, env, keyring, stdout } = setup()
    keyring.set(`zoom-cli:${env.ZM_CONFIG_DIR}`, "example-client:work", entry(NOW + 3600_000))
    expect(await run(["--json", "work", "session", "status"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "")).toMatchObject({ state: "saved" })
  })

  it("in a run with moved folders, never refreshes or removes the owner's sign-in", async () => {
    const memory = memoryKeyring()
    // cli-base keeps the owner's entry only for the system keyring, which no test reaches: this one keeps it the same way.
    const keyring: KeyringStore = {
      get: (service, account) => memory.get(service, account),
      set: (service, account, secret) => memory.set(service, account, secret),
      delete: () => false,
    }
    const { deps, stdout, error, tokenRequests } = setup(keyring)
    memory.set("zoom-cli", "oauth:zoom:work", entry(1))
    expect(await run(["--json", "work", "session", "status", "--check"], deps)).not.toBe(0)
    expect(error()).toMatchObject({ code: "authentication_error", reason: "oauth.moved-rotating" })
    expect(tokenRequests).toEqual([])
    expect(await run(["--json", "work", "session", "end"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "")).toMatchObject({ ended: false, why: expect.stringContaining("moved") })
    expect(memory.get("zoom-cli", "oauth:zoom:work")).toBe(entry(1))
  })

  it("lists every profile here and whether each is signed in, with no profile named", async () => {
    const { deps, keyring, stdout } = setup()
    for (const name of ["work", "fresh"]) addProfile(deps.configPath, name)
    keyring.set("zoom-cli", "oauth:zoom:work", entry(NOW + 60_000))
    expect(await run(["--json", "session", "list"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "").items).toEqual([
      { profile: "fresh", signed_in: false, state: "missing" },
      { profile: "work", signed_in: true, state: "saved" },
    ])
  })

  it("still lists the profiles when the keyring does not answer", async () => {
    const down = () => {
      throw new Error("keyring down")
    }
    const { deps, stdout } = setup({ get: down, set: down, delete: down })
    addProfile(deps.configPath, "work")
    expect(await run(["--json", "session", "list"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "").items).toEqual([{ profile: "work", signed_in: null, state: "unknown" }])
  })

  it("signs in an app without the optional user:read:user scope, and saves a client named for the sign-in", async () => {
    const { deps, keyring, stdout } = setup()
    deps.fetch = async () => Response.json({ code: 4711, message: "Invalid access token, does not contain scopes" })
    deps.openBrowser = async (url) => {
      const state = new URL(url).searchParams.get("state") ?? ""
      await fetch(`http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, code: "c" })}`)
    }
    expect(await run(["--json", "work", "session", "start", "--client-id", "example-flag-client"], deps)).toBe(0)
    expect(readAnswer(stdout.at(-1) ?? "")).toEqual({ profile: "work", signed_in: true, scopes: [] })
    expect(keyring.get("zoom-cli", "oauth:zoom:work")).toContain("example-new")
    expect(readConfig(deps.configPath)).toMatchObject({ clientId: "example-flag-client", profiles: ["work"] })
  })
})
