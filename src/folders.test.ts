import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { loginService, zmPaths } from "./folders.js"

it("resolves current folders without moving an old macOS configuration", () => {
  const sandboxHome = mkdtempSync(join(tmpdir(), "zm-folders-"))
  const old = join(sandboxHome, "Library", "Preferences", "zm")
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, "config.json"), "{}")
  const paths = zmPaths({ env: { HOME: sandboxHome }, platform: "darwin" })
  expect(paths.config).toBe(join(sandboxHome, ".config", "zm"))
  expect(existsSync(join(old, "config.json"))).toBe(true)
  expect(existsSync(join(paths.config, "config.json"))).toBe(false)
  expect(loginService(paths.config)).toBe(`zoom-cli:${paths.config}`)
})
