import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brokenKeyring, type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it, vi } from "vitest"
import { TokenManager } from "./tokens.js"

const login = { accessToken: "example-access", refreshToken: "example-refresh", expiresAt: 1, scopes: [] }
const OLD = "zoom-cli:/example/.config/zm"
const expired = { ...login, expiresAt: 0 }

const setup = (options: { isolated?: boolean; fetch?: typeof fetch; keyring?: KeyringStore } = {}) => {
  const keyring = options.keyring ?? memoryKeyring()
  const configDir = mkdtempSync(join(tmpdir(), "zm-config-"))
  const tokens = () =>
    new TokenManager({
      clientId: "example-client",
      keyring,
      service: "zoom-cli",
      legacyService: OLD,
      configDir,
      ...(options.isolated ? { isolated: true } : {}),
      fetch: options.fetch ?? (async () => new Response()),
      now: () => 1000,
    }).forProfile("work")
  return { keyring, tokens, configDir }
}

describe("where a login is kept (WC-SECR-4)", () => {
  it("falls back to a private file without asking when the keyring fails", () => {
    const { tokens, configDir } = setup({ keyring: brokenKeyring() })
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    tokens().save(login)
    stderr.mockRestore()
    expect(tokens().load()).toEqual(login)
    expect(JSON.parse(readFileSync(join(configDir, "credentials.json"), "utf8"))).toHaveProperty(["oauth:zoom:work"])
  })
})

describe("one sign-in per app and profile (WC-SECR-22, WC-SECR-24)", () => {
  it("copies the old per-folder entry to oauth:zoom:<profile> once, and leaves the old one until sign-out", () => {
    const { keyring, tokens } = setup()
    keyring.set(OLD, "example-client:work", JSON.stringify(login))
    expect(tokens().load()).toEqual(login)
    expect(JSON.parse(keyring.get("zoom-cli", "oauth:zoom:work") ?? "null")).toEqual(login)
    expect(keyring.get(OLD, "example-client:work")).not.toBeNull()
    expect(tokens().remove()).toBe(true)
    expect(keyring.get(OLD, "example-client:work")).toBeNull()
    expect(tokens().load()).toBeNull()
  })

  it("in a moved run, reads the owner's old entry but never copies, deletes or refreshes it", async () => {
    let exchanges = 0
    const { keyring, tokens } = setup({
      isolated: true,
      fetch: async () => {
        exchanges++
        return Response.json({ access_token: "example-new", refresh_token: "example-rotated", expires_in: 3600 })
      },
    })
    keyring.set(OLD, "example-client:work", JSON.stringify(expired))
    expect(tokens().load()).toEqual(expired)
    expect(keyring.get("zoom-cli", "oauth:zoom:work")).toBeNull()
    await expect(tokens().tokens()).rejects.toMatchObject({ details: { reason: "oauth.moved-rotating" } })
    expect(exchanges).toBe(0)
    tokens().remove()
    expect(JSON.parse(keyring.get(OLD, "example-client:work") ?? "null")).toEqual(expired)
  })

  it("refreshes once when two commands find the same expired login, and keeps the rotated token", async () => {
    const sent: URLSearchParams[] = []
    const { keyring, tokens } = setup({
      fetch: async (_url, init) => {
        sent.push(new URLSearchParams(String(init?.body)))
        await new Promise((done) => setTimeout(done, 50))
        return Response.json({ access_token: "example-new", refresh_token: "example-rotated", expires_in: 3600 })
      },
    })
    keyring.set("zoom-cli", "oauth:zoom:work", JSON.stringify(expired))
    const [first, second] = await Promise.all([tokens().tokens(), tokens().tokens()])
    expect(sent).toHaveLength(1)
    expect(Object.fromEntries(sent[0] ?? [])).toEqual({
      grant_type: "refresh_token",
      refresh_token: "example-refresh",
      client_id: "example-client",
    })
    expect(second).toEqual(first)
    expect(JSON.parse(keyring.get("zoom-cli", "oauth:zoom:work") ?? "null")).toMatchObject({
      accessToken: "example-new",
      refreshToken: "example-rotated",
    })
  })

  it("says how to sign in when the profile has none", async () => {
    const { tokens } = setup()
    await expect(tokens().tokens()).rejects.toMatchObject({
      code: "authentication_error",
      message: expect.stringContaining("zm work session start"),
    })
  })
})
