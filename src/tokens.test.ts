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
    tokens.storedIn("keyring").save(login)
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
    tokens.storedIn("file").save(login)
    tokens.save({ ...login, accessToken: "example-refreshed" })
    expect(tokens.storageOf()).toBe("file")
    expect(keyring.get("example-service", "example-client")).toBeNull()
    expect(tokens.load()?.accessToken).toBe("example-refreshed")
  })

  it("moves a file login back to the keyring on the next keyring login", () => {
    const { tokens, keyring, file } = manager()
    tokens.storedIn("file").save(login)
    tokens.storedIn("keyring").save(login)
    expect(tokens.storageOf()).toBe("keyring")
    expect(file()).not.toHaveProperty(["example-client"])
    expect(keyring.get("example-service", "example-client")).not.toBeNull()
  })
})
