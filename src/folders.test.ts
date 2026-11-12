import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  dropOwnFolderOverrides,
  isMovedZmRun,
  legacyLoginService,
  moveLegacyFolders,
  sameConfigFolder,
  zmPaths,
} from "./folders.js"
import { ZOOM_HOSTS } from "./identity.js"
import { permissionKeyForPath } from "./permissions.js"
import { WCAT } from "./wcat.js"

const sandbox = () => {
  const home = mkdtempSync(join(tmpdir(), "zm-folders-"))
  return { home, env: { HOME: home } as NodeJS.ProcessEnv }
}

describe("zm folders", () => {
  it("resolves current folders without moving an old macOS configuration", () => {
    const { home, env } = sandbox()
    const old = join(home, "Library", "Preferences", "zm")
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, "config.json"), "{}")
    const paths = zmPaths({ env, platform: "darwin" })
    expect(paths.config).toBe(join(home, ".config", "zoom-cli"))
    expect(existsSync(join(old, "config.json"))).toBe(true)
    expect(existsSync(join(paths.config, "config.json"))).toBe(false)
  })

  it("keeps the ZM_ overrides and the per-folder name of the old keyring entry", () => {
    const { home, env } = sandbox()
    const moved = join(home, "elsewhere")
    expect(zmPaths({ env: { ...env, ZM_CONFIG_DIR: moved } }).config).toBe(moved)
    expect(isMovedZmRun({ env: { ...env, ZM_CONFIG_DIR: moved } })).toBe(true)
    expect(legacyLoginService({ env })).toBe(`zoom-cli:${join(home, ".config", "zm")}`)
    expect(legacyLoginService({ env: { ...env, ZM_CONFIG_DIR: moved } })).toBe(`zoom-cli:${moved}`)
  })

  it("treats an override naming the default folder, old or new, as the owner's own (the archive timer sets one)", () => {
    const { home, env } = sandbox()
    for (const folder of [join(home, ".config", "zm"), join(home, ".config", "zoom-cli")]) {
      const timer = { ...env, ZM_CONFIG_DIR: folder }
      expect(zmPaths({ env: timer }).config).toBe(join(home, ".config", "zoom-cli"))
      expect(isMovedZmRun({ env: timer })).toBe(isMovedZmRun({ env }))
    }
    expect(sameConfigFolder(join(home, ".config", "zoom-cli"), join(home, ".config", "zm"), { env })).toBe(true)
    expect(sameConfigFolder(join(home, ".config", "zoom-cli"), join(home, "other"), { env })).toBe(false)
  })

  it("moves the old zm folders into the zoom-cli ones, and never replaces what is already there", () => {
    const { home, env } = sandbox()
    const oldConfig = join(home, ".config", "zm")
    const oldState = join(home, ".local", "share", "zm")
    mkdirSync(join(oldConfig, "recording-schedules"), { recursive: true })
    writeFileSync(join(oldConfig, "config.json"), '{"old":true}')
    mkdirSync(join(oldState, "checkpoints"), { recursive: true })
    writeFileSync(join(oldState, "update-check.json"), "old")
    const paths = zmPaths({ env })
    mkdirSync(join(paths.state, "runs"), { recursive: true })
    writeFileSync(join(paths.state, "update-check.json"), "new")
    moveLegacyFolders({ env })
    expect(readFileSync(join(paths.config, "config.json"), "utf8")).toBe('{"old":true}')
    expect(existsSync(join(paths.config, "recording-schedules"))).toBe(true)
    expect(existsSync(oldConfig)).toBe(false)
    expect(existsSync(join(paths.state, "checkpoints"))).toBe(true)
    expect(existsSync(join(paths.state, "runs"))).toBe(true)
    expect(readFileSync(join(paths.state, "update-check.json"), "utf8")).toBe("new")
    expect(readFileSync(join(oldState, "update-check.json"), "utf8")).toBe("old")
    moveLegacyFolders({ env })
  })

  it("moves nothing into a folder an override names", () => {
    const { home, env } = sandbox()
    const oldConfig = join(home, ".config", "zm")
    mkdirSync(oldConfig, { recursive: true })
    writeFileSync(join(oldConfig, "config.json"), "{}")
    const moved = join(home, "elsewhere")
    moveLegacyFolders({ env: { ...env, ZM_CONFIG_DIR: moved } })
    expect(existsSync(join(oldConfig, "config.json"))).toBe(true)
    expect(existsSync(moved)).toBe(false)
  })
})

it("tells WireCat Desktop the hosts zm's fetch is limited to, and each command's permission key", () => {
  expect(WCAT.hosts).toBe(ZOOM_HOSTS)
  expect(WCAT.permissionOf?.(["remote-meetings", "list"])).toBe(permissionKeyForPath(["remote-meetings", "list"]))
})

it("drops an override naming the owner's own folder before cli-core reads it, and keeps a real one", () => {
  const { home, env } = sandbox()
  const timer = { ...env, ZM_CONFIG_DIR: join(home, ".config", "zm"), ZM_STATE_DIR: join(home, "elsewhere") }
  dropOwnFolderOverrides(timer)
  expect(timer).toEqual({ ...env, ZM_STATE_DIR: join(home, "elsewhere") })
})
