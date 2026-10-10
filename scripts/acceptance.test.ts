import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { VERSION } from "../src/version.js"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let install: string
let config: string
let guard: string
let marker: string
let executable: string

const invoke = (...args: string[]) => {
  const result = spawnSync(executable, args, {
    cwd: install,
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      ZM_CONFIG_DIR: config,
      ZM_STATE_DIR: join(install, "state"),
      ZM_CACHE_DIR: join(install, "cache"),
      MESSAGING_STORE: join(install, "unused.db"),
      ZM_ACCEPTANCE_GUARD_MARKER: marker,
      NODE_OPTIONS: `--no-addons --require ${JSON.stringify(guard)}`,
    },
  })
  expect(result.error).toBeUndefined()
  expect(existsSync(marker), "unexpected network, browser or keyring access").toBe(false)
  expect(existsSync(join(install, "unused.db"))).toBe(false)
  return result
}

beforeAll(() => {
  install = mkdtempSync(join(tmpdir(), "zm-test-package-"))
  config = join(install, "config")
  guard = join(install, "guard.cjs")
  marker = join(install, "unexpected-access")
  writeFileSync(join(install, "npmrc"), "")
  writeFileSync(join(install, "npm-globalrc"), "")
  writeFileSync(join(install, "package.json"), JSON.stringify({ private: true, type: "module" }))
  writeFileSync(
    guard,
    `const fs = require('node:fs');
const Module = require('node:module');
const deny = () => {
  fs.appendFileSync(process.env.ZM_ACCEPTANCE_GUARD_MARKER, 'unexpected access\\n');
  throw new Error('acceptance test denied external access');
};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.startsWith('@napi-rs/keyring')) return deny();
  return originalLoad.call(this, request, ...args);
};
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  transport.request = transport.get = deny;
}
const net = require('node:net');
net.connect = net.createConnection = deny;
const child = require('node:child_process');
child.spawn = child.exec = child.execFile = child.spawnSync = child.execSync = child.execFileSync = deny;
require('node:module').syncBuiltinESMExports();
`,
  )
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "pipe", timeout: 30000 })
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", install], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    }),
  ) as { filename: string }[]
  const filename = packed[0]?.filename
  if (!filename) throw new Error("npm pack did not return a tarball")
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund", join(install, filename)],
    {
      cwd: install,
      stdio: "pipe",
      timeout: 90000,
      env: {
        PATH: process.env.PATH,
        npm_config_userconfig: join(install, "npmrc"),
        npm_config_globalconfig: join(install, "npm-globalrc"),
        npm_config_registry: "https://registry.npmjs.org/",
      },
    },
  )
  executable = join(install, "node_modules", ".bin", "zm")
}, 120000)

describe("installed package", () => {
  it("ships usable bin and exports with the package version", () => {
    const pkg = JSON.parse(readFileSync(join(install, "node_modules/@wirecat/zoom-cli/package.json"), "utf8"))
    expect(pkg.version).toBe(VERSION)
    const version = invoke("--version")
    expect(version.status).toBe(0)
    expect(version.stdout.trim()).toBe(pkg.version)
    expect(version.stderr).toBe("")
    const help = invoke("--help")
    expect(help.status).toBe(0)
    expect(help.stdout).toContain("import")
    expect(help.stderr).toBe("")
    expect(existsSync(config)).toBe(false)
    const exports = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const pkg = await import('@wirecat/zoom-cli'); if (typeof pkg.validateDownloadedFiles !== 'function') throw new Error('missing file preflight export')",
      ],
      {
        cwd: install,
        encoding: "utf8",
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          NODE_OPTIONS: `--no-addons --require ${JSON.stringify(guard)}`,
          ZM_ACCEPTANCE_GUARD_MARKER: marker,
        },
      },
    )
    expect(exports.status, exports.stderr).toBe(0)
    expect(existsSync(marker)).toBe(false)
  })

  it("persists only public config and prints JSON without diagnostics", () => {
    const saved = invoke("--json", "config", "set", "zoom.clientId", "invented-public-client")
    expect(saved.status).toBe(0)
    expect(saved.stderr).toBe("")
    expect(JSON.parse(saved.stdout).clientId).toBe("invented-public-client")
    const read = invoke("--json", "config", "show")
    expect(JSON.parse(read.stdout)).toEqual(JSON.parse(saved.stdout))
    expect(read.stderr).toBe("")
    const disk = JSON.parse(readFileSync(join(config, "config.json"), "utf8"))
    expect(Object.keys(disk).sort()).toEqual(["clientId", "filesFolder", "filesTimezone", "source"])
  })

  it("refuses noninteractive login before external access", () => {
    const result = invoke("--no-input", "login")
    expect(result.status).toBe(3)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).error.code).toBe("configuration_error")
  })

  it("classifies invalid commands and refuses unavailable persistence", () => {
    const invalid = invoke("does-not-exist")
    expect(invalid.status).toBe(2)
    expect(invalid.stdout).toBe("")
    expect(JSON.parse(invalid.stderr).error.code).toBe("validation_error")
    const store = invoke("meetings", "list")
    expect(store.status).toBe(3)
    expect(store.stdout).toBe("")
    expect(JSON.parse(store.stderr).error.code).toBe("configuration_error")
  })

  it("keeps malformed public config from blocking help and version", () => {
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, "config.json"), "{invalid")
    for (const args of [["--help"], ["--version"]]) {
      const result = invoke(...args)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe("")
    }
    const show = invoke("config", "show")
    expect(show.status).toBe(3)
    expect(show.stdout).toBe("")
    expect(JSON.parse(show.stderr).error.code).toBe("configuration_error")
  })
})
