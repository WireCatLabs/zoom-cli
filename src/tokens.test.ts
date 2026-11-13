import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brokenKeyring, type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it, vi } from "vitest"
import { TokenManager } from "./tokens.js"

const login = { accessToken: "example-access", refreshToken: "example-refresh", expiresAt: 1, scopes: [] }

const manager = (keyring: KeyringStore = memoryKeyring()) => {
  const configDir = mkdtempSync(join(tmpdir(), "zm-config-"))
  const tokens = new TokenManager({
    clientId: "example-client",
    keyring,
    service: "example-service",
    configDir,
    fetch: async () => new Response(),
  })
  const file = () => JSON.parse(readFileSync(join(configDir, "credentials.json"), "utf8"))
  return { tokens, keyring, configDir, file }
}

describe("where a login is kept (WC-SECR-4)", () => {
  it("falls back to a private file without asking and warns once when the keyring fails", () => {
    const { tokens, configDir, file } = manager(brokenKeyring())
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    tokens.storedIn("keyring").save(login, undefined, { signIn: true })
    const profile = tokens.forProfile("work")
    profile.save(login)
    expect(profile.load()).toEqual(login)
    const warnings = stderr.mock.calls.filter(([text]) => String(text).includes("could not reach the OS keyring"))
    stderr.mockRestore()
    expect(warnings).toHaveLength(1)
    expect(tokens.storageOf()).toBe("file")
    expect(file()).toHaveProperty(["example-client"])
    if (process.platform !== "win32") expect(statSync(join(configDir, "credentials.json")).mode & 0o777).toBe(0o600)
  })

  it("keeps a login in the file when asked, and a refresh stays there", () => {
    const { tokens, keyring } = manager()
    keyring.set("example-service", "example-client", JSON.stringify(login))
    tokens.storedIn("file").save(login, undefined, { signIn: true })
    tokens.save({ ...login, accessToken: "example-refreshed" })
    expect(tokens.storageOf()).toBe("file")
    expect(keyring.get("example-service", "example-client")).toBeNull()
    expect(tokens.load()?.accessToken).toBe("example-refreshed")
  })

  it("keeps a refresh in the file and moves the login back to the keyring on the next sign-in", () => {
    const { tokens, keyring, file } = manager()
    tokens.storedIn("file").save(login, undefined, { signIn: true })
    tokens.save(login)
    expect(tokens.storageOf()).toBe("file")
    tokens.storedIn("keyring").save(login, undefined, { signIn: true })
    expect(tokens.storageOf()).toBe("keyring")
    expect(file()).not.toHaveProperty(["example-client"])
    expect(keyring.get("example-service", "example-client")).not.toBeNull()
  })
})

describe("one sign-in per app and profile (WC-SECR-22, WC-SECR-24)", () => {
  const OLD = "zoom-cli:/example/.config/zm"
  const expired = { ...login, expiresAt: 0 }
  const setup = (options: { isolated?: boolean; fetch?: typeof fetch } = {}) => {
    const keyring = memoryKeyring()
    const configDir = mkdtempSync(join(tmpdir(), "zm-config-"))
    const tokens = (fetcher: typeof fetch = options.fetch ?? (async () => new Response())) =>
      new TokenManager({
        clientId: "example-client",
        keyring,
        service: "zoom-cli",
        legacyService: OLD,
        configDir,
        ...(options.isolated ? { isolated: true } : {}),
        fetch: fetcher,
        now: () => 1000,
      }).forProfile("work")
    return { keyring, tokens }
  }

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

  it("in a moved run, reads the owner's old entry but never copies or deletes it", async () => {
    const { keyring, tokens } = setup({
      isolated: true,
      fetch: async () =>
        Response.json({ access_token: "example-new", refresh_token: "example-rotated", expires_in: 3600 }),
    })
    keyring.set(OLD, "example-client:work", JSON.stringify(login))
    expect(tokens().load()).toEqual(login)
    expect(keyring.get("zoom-cli", "oauth:zoom:work")).toBeNull()
    tokens().remove()
    expect(JSON.parse(keyring.get(OLD, "example-client:work") ?? "null")).toEqual(login)
  })

  it("refreshes once when two processes find the same expired login", async () => {
    let exchanges = 0
    let rotated = 0
    const { keyring, tokens } = setup({
      fetch: async () => {
        exchanges++
        await new Promise((done) => setTimeout(done, 50))
        rotated++
        return Response.json({
          access_token: `example-${rotated}`,
          refresh_token: `rotated-${rotated}`,
          expires_in: 60,
        })
      },
    })
    keyring.set("zoom-cli", "oauth:zoom:work", JSON.stringify(expired))
    const [first, second] = await Promise.all([tokens().tokens(), tokens().tokens()])
    expect(exchanges).toBe(1)
    expect(second).toEqual(first)
  })

  it("gives up when another process holds the refresh too long", async () => {
    const { keyring } = setup()
    const configDir = mkdtempSync(join(tmpdir(), "zm-config-"))
    const slow = new TokenManager({
      clientId: "example-client",
      keyring,
      service: "zoom-cli",
      configDir,
      fetch: () => new Promise(() => {}),
      now: () => 1000,
    }).forProfile("work")
    const waiting = new TokenManager({ ...slow.options, lockWaitMs: 0 })
    keyring.set("zoom-cli", "oauth:zoom:work", JSON.stringify(expired))
    void slow.tokens().catch(() => {})
    await new Promise((done) => setTimeout(done, 50))
    await expect(waiting.tokens()).rejects.toThrow(/another zm process/)
  })
})
