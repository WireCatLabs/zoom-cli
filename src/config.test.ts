import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { filesZone, readConfig, setConfig } from "./config.js"

const configPath = () => join(mkdtempSync(join(tmpdir(), "zm-config-")), "config.json")
const saved = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
const oldFile = {
  clientId: "example-client",
  source: "files",
  filesFolder: "example-folder",
  filesTimezone: "Europe/Madrid",
  accountProfile: "example",
}

describe("config names", () => {
  it("reads a canonical snake_case file without rewriting it or changing its mode", () => {
    const path = configPath()
    const file = {
      client_id: "example-client",
      source: "files",
      files_folder: "example-folder",
      files_timezone: "Europe/Madrid",
      account_profile: "example",
    }
    writeFileSync(path, JSON.stringify(file), { mode: 0o600 })
    const before = readFileSync(path, "utf8")
    expect(readConfig(path)).toEqual(oldFile)
    expect(readFileSync(path, "utf8")).toBe(before)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it("sets zoom.client_id and the old zoom.clientId, saving snake_case", () => {
    const path = configPath()
    expect(setConfig(path, "zoom.client_id", "example-one").clientId).toBe("example-one")
    expect(saved(path)).toMatchObject({ client_id: "example-one" })
    setConfig(path, "zoom.clientId", "example-two")
    setConfig(path, "files.timezone", "Europe/Madrid")
    expect(saved(path)).toMatchObject({ client_id: "example-two", files_timezone: "Europe/Madrid" })
    expect(saved(path)).not.toHaveProperty("clientId")
  })

  it("reads file names in this computer's zone until files.timezone is set, and keeps it unset when saving", () => {
    const path = configPath()
    expect(readConfig(path).filesTimezone).toBeNull()
    expect(filesZone(readConfig(path))).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    setConfig(path, "zoom.client_id", "example-one")
    expect(saved(path).files_timezone).toBeNull()
    setConfig(path, "files.timezone", "Asia/Tokyo")
    expect(filesZone(readConfig(path))).toBe("Asia/Tokyo")
  })

  it("refuses a legacy camelCase file without rewriting it", () => {
    const path = configPath()
    writeFileSync(path, JSON.stringify(oldFile), { mode: 0o600 })
    const before = readFileSync(path, "utf8")
    expect(() => readConfig(path)).toThrow(
      `${path}: clientId is an unknown setting; rename it to client_id (and 2 more problems)`,
    )
    expect(() => readConfig(path)).not.toThrow(/example-client|Europe/)
    expect(readFileSync(path, "utf8")).toBe(before)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it.each(["example-client", "example-other"])("refuses mixed spellings with client_id=%s", (client_id) => {
    const path = configPath()
    const before = JSON.stringify({ ...oldFile, client_id })
    writeFileSync(path, before)
    expect(() => readConfig(path)).toThrow(
      `${path}: clientId is an unknown setting; rename it to client_id (and 1 more problem)`,
    )
    expect(readFileSync(path, "utf8")).toBe(before)
  })

  it("refuses invalid canonical configuration values", () => {
    const path = configPath()
    writeFileSync(
      path,
      JSON.stringify({ client_id: "has spaces", source: "api", files_folder: null, files_timezone: "UTC" }),
    )
    expect(() => readConfig(path)).toThrow(`${path}: client_id has an invalid value`)
    expect(() => readConfig(path)).not.toThrow(/has spaces/)
  })

  it("names a broken JSON file by its path alone", () => {
    const path = configPath()
    writeFileSync(path, "{ example")
    expect(() => readConfig(path)).toThrow(`${path} is not valid JSON`)
  })
})
