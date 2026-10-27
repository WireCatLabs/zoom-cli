import { execFileSync, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/client"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { beforeAll, describe, expect, it } from "vitest"
import { VERSION } from "../src/version.js"
import { readAnswer } from "./testing/answers.js"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let install: string
let config: string
let guard: string
let marker: string
let executable: string

const environment = () => ({
  PATH: process.env.PATH,
  HOME: install,
  USERPROFILE: install,
  ZM_CONFIG_DIR: config,
  ZM_STATE_DIR: join(install, "state"),
  ZM_CACHE_DIR: join(install, "cache"),
  MESSAGING_STORE: join(install, "unused.db"),
  ZM_ACCEPTANCE_GUARD_MARKER: marker,
  NODE_OPTIONS: `--no-addons --require ${JSON.stringify(guard)}`,
})
const npmEnvironment = () => ({
  PATH: process.env.PATH,
  HOME: install,
  USERPROFILE: install,
  npm_config_userconfig: join(install, "npmrc"),
  npm_config_globalconfig: join(install, "npm-globalrc"),
  npm_config_registry: "https://registry.npmjs.org/",
})
const diagnostics = (text: string): string =>
  text.replace(
    /\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n(?:\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n)?/g,
    "",
  )
const invoke = (...args: string[]) => {
  const database = join(install, "unused.db")
  const existedBefore = existsSync(database)
  const timestampBefore = existedBefore ? statSync(database).mtimeMs : null
  const words = args.filter(
    (arg, index) => !arg.startsWith("--") && !["--timeout", "--max-output-bytes"].includes(args[index - 1] ?? ""),
  )
  const storeCommands = ["meetings", "events", "watch", "search"]
  const command = storeCommands.includes(words[0] ?? "") ? words[0] : words[1]
  const opensStore = !args.includes("--help") && storeCommands.includes(command ?? "")
  const result = spawnSync(executable, args, {
    cwd: install,
    encoding: "utf8",
    timeout: 10000,
    env: environment(),
  })
  expect(result.error).toBeUndefined()
  expect(existsSync(marker), "unexpected network, browser or keyring access").toBe(false)
  if (!opensStore) {
    expect(existsSync(database)).toBe(existedBefore)
    if (existedBefore) expect(statSync(database).mtimeMs).toBe(timestampBefore)
  }
  return { ...result, stderr: diagnostics(result.stderr) }
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
  // Invoke the installed compiler directly: fixture HOME must not select a different package manager.
  try {
    execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--build"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 65536,
      env: npmEnvironment(),
    })
  } catch (error) {
    const output = (value: unknown): string => {
      const text = typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("utf8") : ""
      return text.slice(0, 8192)
    }
    const failure = error as { stdout?: unknown; stderr?: unknown }
    throw new Error(`installed-package TypeScript build failed\n${output(failure.stdout)}\n${output(failure.stderr)}`)
  }
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", install], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: npmEnvironment(),
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
      env: npmEnvironment(),
    },
  )
  executable = join(install, "node_modules", ".bin", "zm")
}, 120000)

// These process-boundary checks share one retained, invented installation and database.
// A case starts several real installed processes, each with its own bounded subprocess timeout.
describe("installed package", { concurrent: false, shuffle: false, timeout: 15000 }, () => {
  let importedMeetingId: string
  it("ships a usable bin with the package version", () => {
    const pkg = JSON.parse(readFileSync(join(install, "node_modules/@wirecat/zoom-cli/package.json"), "utf8"))
    expect(pkg.version).toBe(VERSION)
    const version = invoke("--version")
    expect(version.status).toBe(0)
    expect(version.stdout.trim()).toBe(pkg.version)
    expect(version.stderr).toBe("")
    expect(existsSync(config)).toBe(false)
  })

  it("shows general and ingestion help without configuration", () => {
    const help = invoke("--help")
    expect(help.status).toBe(0)
    expect(help.stdout).toContain("zm — your Zoom meetings for agents")
    expect(help.stdout).toContain("ZM_READ_ONLY=1 zm …")
    expect(help.stdout).toContain("zm guide")
    expect(help.stderr).toBe("")
    const full = invoke("--help-all")
    expect(full.status).toBe(0)
    expect(full.stdout).toContain("remote-meetings")
    const guide = invoke("guide", "find-quote")
    expect(guide.status).toBe(0)
    expect(guide.stdout).toContain("zm personal search meetings")
    const pullHelp = invoke("meetings", "sync", "--help")
    expect(pullHelp.status).toBe(0)
    expect(pullHelp.stdout).toContain("--lookback-days")
    expect(pullHelp.stderr).toBe("")
    expect(existsSync(config)).toBe(false)
  })

  it("exposes its public file preflight adapter", () => {
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
        env: environment(),
      },
    )
    expect(exports.status, exports.stderr).toBe(0)
    expect(existsSync(marker)).toBe(false)
  })

  it("persists only public config and prints JSON without diagnostics", () => {
    const saved = invoke("--json", "config", "set", "zoom.client_id", "invented-public-client")
    expect(saved.status).toBe(0)
    expect(saved.stderr).toBe("")
    expect(readAnswer(saved.stdout).client_id).toBe("invented-public-client")
    const read = invoke("--json", "config", "show")
    expect(readAnswer(read.stdout)).toEqual(readAnswer(saved.stdout))
    expect(read.stderr).toBe("")
    const disk = JSON.parse(readFileSync(join(config, "config.json"), "utf8"))
    expect(Object.keys(disk)).toEqual(["client_id"])
  })

  it("discovers the installed MCP tools for a named profile without config or database and exits on EOF", async () => {
    const isolated = join(install, "mcp-config")
    const child = spawn(executable, ["personal", "mcp", "serve"], {
      cwd: install,
      env: { ...environment(), ZM_CONFIG_DIR: isolated, MESSAGING_STORE: join(install, "mcp-unused.db") },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let errors = ""
    child.stderr.on("data", (chunk) => {
      errors += String(chunk)
    })
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
    })
    const client = new Client({ name: "invented-install-check", version: "1" })
    try {
      await client.connect(new StdioServerTransport(child.stdout, child.stdin))
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual(["zm_tools_search", "zm_read", "zm_write"])
      const found = await client.callTool({ name: "zm_tools_search", arguments: { query: "meetings list" } })
      const [first] = (found.structuredContent as { items: unknown[] }).items
      expect(first).toMatchObject({ command: "meetings list", writes: false })
      expect(existsSync(isolated)).toBe(false)
      expect(existsSync(join(install, "mcp-unused.db"))).toBe(false)
      child.stdin.end()
      expect(await exited).toBe(0)
      expect(errors).toBe("")
      expect(existsSync(marker)).toBe(false)
    } finally {
      await client.close()
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      await exited
    }
  }, 15000)

  it("rejects an invalid profile word", () => {
    const invalid = invoke("bad profile", "meetings", "list")
    expect(invalid.status).toBe(2)
    expect(invalid.stdout).toBe("")
    expect(JSON.parse(invalid.stderr).error.code).toBe("validation_error")
    const saved = invoke("--json", "config", "show")
    expect(readAnswer(saved.stdout)).toMatchObject({ profiles: [] })
  })

  it("refuses noninteractive login before external access", () => {
    const result = invoke("--no-input", "personal", "session", "start")
    expect(result.status).toBe(3)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).error.code).toBe("configuration_error")
  })

  it("classifies invalid commands, requires a profile and rejects a profile without stored data", () => {
    const invalid = invoke("personal", "does-not-exist")
    expect(invalid.status).toBe(2)
    expect(invalid.stdout).toBe("")
    expect(JSON.parse(invalid.stderr).error.code).toBe("validation_error")
    const unnamed = invoke("meetings", "list")
    expect(unnamed.status).toBe(2)
    expect(JSON.parse(unnamed.stderr).error).toMatchObject({ code: "validation_error", details: { profiles: [] } })
    const store = invoke("personal", "meetings", "list")
    expect(store.status).toBe(3)
    expect(store.stdout).toBe("")
    expect(JSON.parse(store.stderr).error.code).toBe("configuration_error")
  })

  it("persists imports across processes and replays without duplicating the occurrence", () => {
    const files = join(install, "transcripts")
    mkdirSync(files)
    const transcript = join(files, "2026-10-10_1530_example.vtt")
    const original = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Original example\n"
    writeFileSync(transcript, original)
    for (let attempt = 0; attempt < 2; attempt++) {
      const imported = invoke("personal", "--json", "meetings", "import", files)
      expect(imported.status, imported.stderr).toBe(0)
      expect(imported.stderr).toBe("")
    }
    const listed = invoke("personal", "--json", "meetings", "list")
    expect(listed.status, listed.stderr).toBe(0)
    const meetings = JSON.parse(listed.stdout).items
    expect(meetings).toHaveLength(1)
    const id = String(meetings[0].id)
    importedMeetingId = id
    expect(readAnswer(invoke("personal", "--json", "meetings", "show", id).stdout).transcripts).toHaveLength(1)
  })

  it("retains the original revision when importing corrected transcript bytes", () => {
    const files = join(install, "transcripts")
    const transcript = join(files, "2026-10-10_1530_example.vtt")
    const original = readFileSync(transcript, "utf8")
    writeFileSync(transcript, original.replace("Original", "Corrected"))
    const corrected = invoke("personal", "--json", "meetings", "import", files)
    expect(corrected.status, corrected.stderr).toBe(0)
    const id = importedMeetingId
    expect(readAnswer(invoke("personal", "--json", "meetings", "show", id).stdout).transcripts).toHaveLength(1)
    expect(
      JSON.parse(invoke("personal", "--json", "meetings", "transcript", id, "--history").stdout).items,
    ).toHaveLength(2)
  })

  it("searches only the current correction", () => {
    expect(JSON.parse(invoke("personal", "--json", "search", "meetings", "Corrected").stdout).items).toHaveLength(1)
    expect(JSON.parse(invoke("personal", "--json", "search", "meetings", "Original").stdout).items).toHaveLength(0)
  })

  it("exposes retained history, stored events and absent summaries explicitly", () => {
    const id = importedMeetingId
    expect(JSON.parse(invoke("personal", "--json", "events", "list").stdout).items).toHaveLength(1)
    expect(
      JSON.parse(invoke("personal", "--json", "meetings", "transcript", id, "--history").stdout).items,
    ).toHaveLength(2)
    expect(JSON.parse(invoke("personal", "--json", "meetings", "summary", id).stdout).items).toHaveLength(0)
  })

  it("exports the current revision without overwriting an existing destination", () => {
    const id = importedMeetingId
    const exported = invoke("personal", "--json", "meetings", "export", id, "--format", "vtt")
    expect(exported.status, exported.stderr).toBe(0)
    const content = readAnswer(exported.stdout).content
    expect(content).toContain("Corrected example")
    expect(content).not.toContain("Original example")
    const destination = join(install, "exported.vtt")
    const written = invoke("personal", "--json", "meetings", "export", id, "--format", "vtt", "--output", destination)
    expect(written.status, written.stderr).toBe(0)
    expect(readFileSync(destination, "utf8")).toBe(content)
    const overwrite = invoke("personal", "--json", "meetings", "export", id, "--format", "vtt", "--output", destination)
    expect(overwrite.status).toBe(2)
    expect(overwrite.stdout).toBe("")
    expect(readFileSync(destination, "utf8")).toBe(content)
  })

  it("rejects an absent profile without registering a new account", () => {
    const absent = invoke("absent-example", "--json", "meetings", "list")
    expect(absent.status).toBe(3)
    expect(absent.stdout).toBe("")
    expect(JSON.parse(absent.stderr).error.code).toBe("configuration_error")
    const accounts = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const { openStore } = await import('@wirecat/cli-core/store');
      const store = await openStore();
      try { console.log(JSON.stringify(await store.accounts.storedAccounts())); }
      finally { await store.close(); }
    `,
      ],
      {
        cwd: install,
        encoding: "utf8",
        timeout: 10000,
        env: environment(),
      },
    )
    expect(accounts.status, accounts.stderr).toBe(0)
    expect(JSON.parse(accounts.stdout)).toEqual([
      expect.objectContaining({ provider: "zoom", account: "zm-profile:personal" }),
    ])
    expect(existsSync(marker)).toBe(false)
  })

  it("stops an installed folder watch after its receipt and leaves persistent data readable", async () => {
    const folder = join(install, "watch-transcripts")
    mkdirSync(folder)
    writeFileSync(
      join(folder, "2026-10-11_1530_watch-example.vtt"),
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Watched example\n",
    )
    const child = spawn(executable, ["personal", "watch", "files", folder, "--pause", "10s", "--jsonl"], {
      cwd: install,
      env: environment(),
      stdio: ["pipe", "pipe", "pipe"],
    })
    let output = ""
    let errors = ""
    let stopped = false
    child.stdout.on("data", (chunk) => {
      output += String(chunk)
      if (!stopped && output.includes("\n")) {
        stopped = true
        child.kill("SIGINT")
      }
    })
    child.stderr.on("data", (chunk) => {
      errors += String(chunk)
    })
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
    })
    const deadline = setTimeout(() => child.kill("SIGTERM"), 10000)
    try {
      expect(await exited, errors).toBe(0)
      const receipts = output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      expect(receipts).toHaveLength(2)
      expect(receipts[1]).toMatchObject({ type: "end", complete: true })
      expect(receipts[0].data.meetings).toBe(1)
      expect(diagnostics(errors)).toBe("")
      const reopened = invoke("personal", "--json", "search", "meetings", "Watched")
      expect(reopened.status, reopened.stderr).toBe(0)
      expect(JSON.parse(reopened.stdout).items).toHaveLength(1)
      expect(existsSync(marker)).toBe(false)
    } finally {
      clearTimeout(deadline)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      await exited
    }
  }, 15000)

  it("keeps malformed public config from blocking help and version", () => {
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, "config.json"), "{invalid")
    for (const args of [["--help"], ["--version"]]) {
      const result = invoke(...args)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe("")
    }
    const show = invoke("config", "show")
    expect(show.status).toBe(0)
    expect(show.stderr).toContain("the file is not valid JSON at line 1, column 2, so it is left out")
    const list = invoke("personal", "meetings", "list")
    expect(list.status).toBe(3)
    expect(list.stdout).toBe("")
    expect(JSON.parse(list.stderr).error.code).toBe("configuration_error")
  })
})
