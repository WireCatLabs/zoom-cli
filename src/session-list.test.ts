import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { addProfile } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const NOW = Date.UTC(2026, 9, 10)

const setup = async (env: NodeJS.ProcessEnv) => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-session-list-"))
  const stdout: string[] = []
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    env,
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: memoryKeyring(),
      service: "example",
      now: () => NOW,
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
    now: () => NOW,
  }
  return { deps, stdout, stderr }
}

const saved = (expiresAt: number) => ({
  accessToken: "example-access",
  refreshToken: "example-refresh",
  expiresAt,
  scopes: ["user:read:user"],
})

describe("session list", () => {
  it("lists every profile on this computer with its saved login, with no profile named", async () => {
    const { deps, stdout } = await setup({ ZM_ZOOM_CLIENT_ID: "example-client" })
    for (const name of ["work", "old", "fresh"]) addProfile(deps.configPath, name)
    deps.tokens.forProfile("work").save(saved(NOW + 60_000))
    deps.tokens.forProfile("old").save(saved(NOW - 60_000))

    expect(await run(["--json", "session", "list"], deps)).toBe(0)

    expect(readAnswer(stdout.at(-1) ?? "").items).toEqual([
      { profile: "fresh", signed_in: false, state: "missing" },
      { profile: "old", signed_in: true, state: "expired", expires_at: NOW - 60_000, scopes: ["user:read:user"] },
      { profile: "work", signed_in: true, state: "saved", expires_at: NOW + 60_000, scopes: ["user:read:user"] },
    ])
  })

  it("says not_configured for each profile while no Zoom app is set, and still whether a login is saved", async () => {
    const { deps, stdout } = await setup({})
    addProfile(deps.configPath, "work")

    expect(await run(["--json", "session", "list"], deps)).toBe(0)

    expect(readAnswer(stdout.at(-1) ?? "").items).toEqual([
      { profile: "work", signed_in: false, state: "not_configured" },
    ])
  })

  it("still lists the profiles when the keyring does not answer, with their login unknown", async () => {
    const { deps, stdout } = await setup({ ZM_ZOOM_CLIENT_ID: "example-client" })
    addProfile(deps.configPath, "work")
    deps.tokens = new TokenManager({
      ...deps.tokens.options,
      keyring: {
        get: () => {
          throw new Error("keyring down")
        },
        set: () => {
          throw new Error("keyring down")
        },
        delete: () => {
          throw new Error("keyring down")
        },
      },
    })

    expect(await run(["--json", "session", "list"], deps)).toBe(0)

    expect(readAnswer(stdout.at(-1) ?? "").items).toEqual([{ profile: "work", signed_in: null, state: "unknown" }])
  })
})
