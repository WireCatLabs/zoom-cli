import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
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
  const database = join(install, "unused.db")
  const existedBefore = existsSync(database)
  const timestampBefore = existedBefore ? statSync(database).mtimeMs : null
  const command = args.find((arg) => !arg.startsWith("--"))
  const opensStore = !args.includes("--help") && ["meetings", "events", "import", "pull"].includes(command ?? "")
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
  if (!opensStore) {
    expect(existsSync(database)).toBe(existedBefore)
    if (existedBefore) expect(statSync(database).mtimeMs).toBe(timestampBefore)
  }
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
    const pullHelp = invoke("pull", "--help")
    expect(pullHelp.status).toBe(0)
    expect(pullHelp.stdout).toContain("--lookback-days")
    expect(pullHelp.stderr).toBe("")
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
    expect(Object.keys(disk).sort()).toEqual(["accountProfile", "clientId", "filesFolder", "filesTimezone", "source"])
  })

  it("selects a local profile and rejects invalid labels", () => {
    const selected = invoke("--json", "config", "set", "account.profile", "personal")
    expect(selected.status).toBe(0)
    expect(selected.stderr).toBe("")
    expect(JSON.parse(selected.stdout).accountProfile).toBe("personal")
    const invalid = invoke("config", "set", "account.profile", "bad profile")
    expect(invalid.status).toBe(2)
    expect(invalid.stdout).toBe("")
    expect(JSON.parse(invalid.stderr).error.code).toBe("validation_error")
    const saved = invoke("--json", "config", "show")
    expect(JSON.parse(saved.stdout).accountProfile).toBe("personal")
  })

  it("refuses noninteractive login before external access", () => {
    const result = invoke("--no-input", "login")
    expect(result.status).toBe(3)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).error.code).toBe("configuration_error")
  })

  it("classifies invalid commands and rejects a profile without stored data", () => {
    const invalid = invoke("does-not-exist")
    expect(invalid.status).toBe(2)
    expect(invalid.stdout).toBe("")
    expect(JSON.parse(invalid.stderr).error.code).toBe("validation_error")
    const store = invoke("meetings", "list")
    expect(store.status).toBe(3)
    expect(store.stdout).toBe("")
    expect(JSON.parse(store.stderr).error.code).toBe("configuration_error")
  })

  it("persists imports across processes and searches only the current correction", () => {
    const files = join(install, "transcripts")
    mkdirSync(files)
    const transcript = join(files, "2026-10-10_1530_example.vtt")
    const original = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Original example\n"
    writeFileSync(transcript, original)
    for (let attempt = 0; attempt < 2; attempt++) {
      const imported = invoke("--json", "import", files)
      expect(imported.status, imported.stderr).toBe(0)
      expect(imported.stderr).toBe("")
    }
    const listed = invoke("--json", "meetings", "list")
    expect(listed.status, listed.stderr).toBe(0)
    const meetings = JSON.parse(listed.stdout).items
    expect(meetings).toHaveLength(1)
    const id = String(meetings[0].id)
    expect(JSON.parse(invoke("--json", "meetings", "show", id).stdout).transcripts).toHaveLength(1)

    writeFileSync(transcript, original.replace("Original", "Corrected"))
    const corrected = invoke("--json", "import", files)
    expect(corrected.status, corrected.stderr).toBe(0)
    expect(JSON.parse(invoke("--json", "meetings", "show", id).stdout).transcripts).toHaveLength(2)
    expect(JSON.parse(invoke("--json", "meetings", "search", "Corrected").stdout).items).toHaveLength(1)
    expect(JSON.parse(invoke("--json", "meetings", "search", "Original").stdout).items).toHaveLength(0)
    expect(JSON.parse(invoke("--json", "events", "list").stdout).items).toHaveLength(1)

    const selected = invoke("config", "set", "account.profile", "absent-example")
    expect(selected.status, selected.stderr).toBe(0)
    const absent = invoke("--json", "meetings", "list")
    expect(absent.status).toBe(3)
    expect(absent.stdout).toBe("")
    expect(JSON.parse(absent.stderr).error.code).toBe("configuration_error")
    const accounts = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const { openStore } = await import('@wirecat/cli-messaging/store');
      const store = await openStore();
      try { console.log(JSON.stringify(await store.storedAccounts())); }
      finally { await store.close(); }
    `,
      ],
      {
        cwd: install,
        encoding: "utf8",
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          MESSAGING_STORE: join(install, "unused.db"),
          NODE_OPTIONS: `--no-addons --require ${JSON.stringify(guard)}`,
          ZM_ACCEPTANCE_GUARD_MARKER: marker,
        },
      },
    )
    expect(accounts.status, accounts.stderr).toBe(0)
    expect(JSON.parse(accounts.stdout)).toEqual([
      expect.objectContaining({ provider: "zoom", account: "zm-profile:personal" }),
    ])
    expect(existsSync(marker)).toBe(false)
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
