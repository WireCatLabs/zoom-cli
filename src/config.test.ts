import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { filesZone, inspectConfig, readConfig, setConfig, unsetConfig } from "./config.js"
import { publicIssue } from "./config-issues.js"

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

  it("says what each value has to be, and gives a fix only where a shell keeps it whole", () => {
    const path = configPath()
    writeFileSync(
      path,
      JSON.stringify({
        source: "browser",
        files_folder: 5,
        keep_runs_for_days: 0,
        context_sources: "example",
        profiles: { "bad name": {}, broken: 5, work: { permissions: { "Bad Key": "deny" } } },
      }),
    )
    expect(inspectConfig(path).issues.map(publicIssue)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "source", what: 'setting source has to be one of ("api" | "files")' }),
        expect.objectContaining({ key: "files.folder", what: "setting files.folder has to be of type string" }),
        expect.objectContaining({ key: "keep_runs_for_days", what: "setting keep_runs_for_days has to be >=1" }),
        expect.objectContaining({ key: "context.sources", fix: "zm config unset context.sources" }),
        { kind: "invalid_value", file: path, key: "profiles.bad name", what: expect.stringContaining("profile name") },
        expect.objectContaining({ key: "profiles.broken", fix: "zm config unset profiles.broken" }),
        expect.objectContaining({ kind: "unknown_permission", profile: "work", key: "permissions.Bad Key" }),
      ]),
    )
    expect(() => setConfig(path, "context.sources", "[]", () => "work")).toThrow("setting context.sources")
    expect(() => setConfig(path, "permissions", "{}")).toThrow("name a profile")
    expect(() => unsetConfig(path, "permissions.meetings", undefined)).toThrow("name a profile")
  })

  it("refuses a file that is not an object, by the whole file, with no fix", () => {
    const path = configPath()
    writeFileSync(path, "[]")
    expect(inspectConfig(path).issues.map(publicIssue)).toEqual([
      { kind: "invalid_value", file: path, what: "the file has to be an object, in braces" },
    ])
    expect(() => unsetConfig(path, "source", undefined)).toThrow("the file has to be an object")
  })

  it("unsets one profile's context sources and leaves the others", () => {
    const path = configPath()
    const source = { id: "work-messages", kind: "message", provider: "example-messenger", account: "AliceExample" }
    setConfig(path, "context.sources", JSON.stringify([source]), () => "work")
    setConfig(path, "context.sources", JSON.stringify([source]), () => "home")
    expect(unsetConfig(path, "context.sources", "work").contextSources).toEqual([{ ...source, profile: "home" }])
  })

  it("names a config path it cannot read", () => {
    const path = configPath()
    mkdirSync(path)
    expect(() => readConfig(path)).toThrow(`${path} could not be read`)
  })
})
