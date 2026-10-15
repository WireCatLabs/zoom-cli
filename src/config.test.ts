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
  it("refuses camelCase files without rewriting them", () => {
    const path = configPath()
    const text = JSON.stringify(oldFile)
    writeFileSync(path, text, { mode: 0o600 })
    expect(() => readConfig(path)).toThrow("zm config is invalid")
    expect(readFileSync(path, "utf8")).toBe(text)
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
    expect(() => readConfig(path)).toThrow("zm config is invalid")
  })

  it("refuses old names even when snake_case values match", () => {
    const path = configPath()
    writeFileSync(path, JSON.stringify({ ...oldFile, client_id: "example-client" }))
    expect(() => readConfig(path)).toThrow("zm config is invalid")
  })
})
