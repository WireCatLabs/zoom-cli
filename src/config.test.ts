import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { filesZone, readConfig, setConfig, unsetConfig } from "./config.js"

const configPath = () => join(mkdtempSync(join(tmpdir(), "zm-config-")), "config.json")
const saved = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
describe("config names", () => {
  it("reads a snake_case file without rewriting it or changing its mode", () => {
    const path = configPath()
    const file = {
      client_id: "example-client",
      source: "files",
      files_folder: "example-folder",
      files_timezone: "Europe/Madrid",
      profiles: { example: {} },
    }
    writeFileSync(path, JSON.stringify(file), { mode: 0o600 })
    const before = readFileSync(path, "utf8")
    expect(readConfig(path)).toEqual({
      clientId: "example-client",
      source: "files",
      filesFolder: "example-folder",
      filesTimezone: "Europe/Madrid",
      profiles: ["example"],
      permissions: {},
    })
    expect(readFileSync(path, "utf8")).toBe(before)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it("sets zoom.client_id, saving snake_case", () => {
    const path = configPath()
    expect(setConfig(path, "zoom.client_id", "example-one").clientId).toBe("example-one")
    setConfig(path, "files.timezone", "Europe/Madrid")
    expect(saved(path)).toEqual({ client_id: "example-one", files_timezone: "Europe/Madrid" })
  })

  it("reads file names in this computer's zone until files.timezone is set, and keeps it unset when saving", () => {
    const path = configPath()
    expect(readConfig(path).filesTimezone).toBeNull()
    expect(filesZone(readConfig(path))).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    setConfig(path, "zoom.client_id", "example-one")
    expect(saved(path)).not.toHaveProperty("files_timezone")
    setConfig(path, "files.timezone", "Asia/Tokyo")
    expect(filesZone(readConfig(path))).toBe("Asia/Tokyo")
  })

  it("refuses an unknown key by its first problem, without rewriting the file or quoting a value", () => {
    const path = configPath()
    const before = JSON.stringify({ example_id: "example-client", source: "files", example_folder: "example-folder" })
    writeFileSync(path, before, { mode: 0o600 })
    expect(() => readConfig(path)).toThrow(
      `${path}: setting example_id is not a setting of zm — remove it with \`zm config unset example_id\`` +
        " (and 1 more problem — `zm doctor` lists them all)",
    )
    expect(() => readConfig(path)).not.toThrow(/example-client|example-folder/)
    expect(readFileSync(path, "utf8")).toBe(before)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it("sets and unsets on a file with problems, keeping what it does not touch", () => {
    const path = configPath()
    writeFileSync(path, JSON.stringify({ example_id: "example-client", source: "files" }))
    expect(setConfig(path, "files.folder", "example-folder")).toMatchObject({ source: "files" })
    expect(saved(path)).toEqual({ example_id: "example-client", source: "files", files_folder: "example-folder" })
    unsetConfig(path, "example_id", undefined)
    unsetConfig(path, "files.folder", undefined)
    expect(saved(path)).toEqual({ source: "files" })
    expect(() => unsetConfig(path, "example_key", undefined)).toThrow("unknown config key")
  })

  it("refuses invalid configuration values by the rule, not the value", () => {
    const path = configPath()
    writeFileSync(path, JSON.stringify({ client_id: "has spaces", source: "api" }))
    expect(() => readConfig(path)).toThrow(
      `${path}: setting zoom.client_id has to be a Zoom client ID, without spaces — remove it with ` +
        "`zm config unset zoom.client_id`",
    )
    expect(() => readConfig(path)).not.toThrow(/has spaces/)
  })

  it("names where broken JSON stops parsing, and refuses to write over it", () => {
    const path = configPath()
    writeFileSync(path, "{ example")
    expect(() => readConfig(path)).toThrow(`${path}: the file is not valid JSON at line 1, column 3`)
    expect(() => setConfig(path, "source", "api")).toThrow("not valid JSON")
    expect(readFileSync(path, "utf8")).toBe("{ example")
  })
})
