import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readConfig, setConfig } from "./config.js"

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
  it("reads a camelCase file and rewrites it in snake_case, keeping the mode", () => {
    const path = configPath()
    writeFileSync(path, JSON.stringify(oldFile), { mode: 0o600 })
    expect(readConfig(path)).toEqual(oldFile)
    expect(saved(path)).toEqual({
      client_id: "example-client",
      source: "files",
      files_folder: "example-folder",
      files_timezone: "Europe/Madrid",
      account_profile: "example",
    })
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

  it("refuses both spellings of one setting with different values", () => {
    const path = configPath()
    writeFileSync(path, JSON.stringify({ ...oldFile, client_id: "example-other" }))
    expect(() => readConfig(path)).toThrow(/clientId and client_id are the same setting/)
  })

  it("accepts both spellings with the same value", () => {
    const path = configPath()
    writeFileSync(path, JSON.stringify({ ...oldFile, client_id: "example-client" }))
    expect(readConfig(path).clientId).toBe("example-client")
  })
})
