import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KeyringStore } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { loginService, zmPaths } from "./folders.js"

const memoryKeyring = (): KeyringStore & { entries: Map<string, string> } => {
  const entries = new Map<string, string>()
  return {
    entries,
    get: (service, account) => entries.get(`${service}|${account}`) ?? null,
    set: (service, account, secret) => void entries.set(`${service}|${account}`, secret),
    delete: (service, account) => entries.delete(`${service}|${account}`),
  }
}

const mac = (HOME: string) => ({ env: { HOME }, platform: "darwin" as const, holders: () => [] })

const macHome = () => {
  const HOME = mkdtempSync(join(tmpdir(), "zm-folders-"))
  const old = join(HOME, "Library", "Preferences", "zm")
  mkdirSync(old, { recursive: true })
  writeFileSync(
    join(old, "config.json"),
    JSON.stringify({
      clientId: "client-a",
      source: "api",
      filesFolder: null,
      filesTimezone: "UTC",
      accountProfile: null,
    }),
  )
  return { HOME, old, fresh: join(HOME, ".config", "zm") }
}

describe("zmPaths", () => {
  it("moves the config out of ~/Library and carries the login over to the new keyring name", () => {
    const { HOME, old, fresh } = macHome()
    const keyring = memoryKeyring()
    keyring.set(loginService(old), "client-a", "tokens")

    const paths = zmPaths(keyring, () => {}, mac(HOME))

    expect(paths.config).toBe(fresh)
    expect(existsSync(join(fresh, "config.json"))).toBe(true)
    expect(keyring.get(loginService(fresh), "client-a")).toBe("tokens")
    expect(keyring.get(loginService(old), "client-a")).toBe("tokens")
  })

  it("keeps a login already saved under the new name", () => {
    const { HOME, old, fresh } = macHome()
    const keyring = memoryKeyring()
    keyring.set(loginService(old), "client-a", "old tokens")
    keyring.set(loginService(fresh), "client-a", "new tokens")

    zmPaths(keyring, () => {}, mac(HOME))

    expect(keyring.get(loginService(fresh), "client-a")).toBe("new tokens")
  })

  it("warns and keeps the moved folders when the keyring cannot be read", () => {
    const { HOME, fresh } = macHome()
    const warnings: string[] = []
    const broken = {
      ...memoryKeyring(),
      get: () => {
        throw new Error("locked")
      },
    }

    expect(zmPaths(broken, (line) => warnings.push(line), mac(HOME)).config).toBe(fresh)
    expect(warnings).toEqual([expect.stringMatching(/run `zm login` again/)])
  })

  it("warns and stays on the old folders while another process holds them", () => {
    const { HOME, old } = macHome()
    const warnings: string[] = []

    const paths = zmPaths(memoryKeyring(), (line) => warnings.push(line), { ...mac(HOME), holders: () => ["pid 7"] })

    expect(paths.config).toBe(old)
    expect(existsSync(join(old, "config.json"))).toBe(true)
    expect(warnings).toEqual([expect.stringMatching(/^zm: kept its files in ~\/Library for now — .*pid 7/)])
  })
})
