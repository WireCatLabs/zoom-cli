import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(process.argv[2])
const expectedVersion = process.argv[3]
assert.ok(expectedVersion, "provide an isolated install directory and package version")
const packageRoot = join(root, "node_modules", "@wirecat", "zoom-cli")
const metadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
assert.equal(metadata.version, expectedVersion)
const require = createRequire(join(packageRoot, "package.json"))
const producerRequire = createRequire(require.resolve("@wirecat/cli-messaging"))
assert.equal(require.resolve("@wirecat/cli-meetings"), producerRequire.resolve("@wirecat/cli-meetings"))
const guard = join(root, "guard.cjs")
const denied = join(root, "denied")
const loaded = join(root, "loaded")
const sandbox = join(root, "runtime")
mkdirSync(sandbox)
const environment = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  TEMP: sandbox,
  TMP: sandbox,
  HOME: sandbox,
  USERPROFILE: sandbox,
  APPDATA: join(sandbox, "appdata"),
  LOCALAPPDATA: join(sandbox, "localappdata"),
  XDG_CONFIG_HOME: join(sandbox, "xdg-config"),
  XDG_STATE_HOME: join(sandbox, "xdg-state"),
  XDG_CACHE_HOME: join(sandbox, "xdg-cache"),
  ZM_CONFIG_DIR: join(sandbox, "config"),
  ZM_STATE_DIR: join(sandbox, "state"),
  ZM_CACHE_DIR: join(sandbox, "cache"),
  MESSAGING_STORE: join(sandbox, "wirecat.db"),
  ZM_PLATFORM_DENIED: denied,
  ZM_PLATFORM_LOADED: loaded,
}
writeFileSync(
  guard,
  `
const fs=require('node:fs'),mod=require('node:module');
fs.writeFileSync(process.env.ZM_PLATFORM_LOADED,'loaded');
const deny=()=>{fs.appendFileSync(process.env.ZM_PLATFORM_DENIED,'denied\\n');throw Error('unexpected external IO')};
const load=mod._load;mod._load=function(name,...args){if(name.startsWith('@napi-rs/keyring')||name==='keytar')return deny();return load.call(this,name,...args)};
globalThis.fetch=deny;
for(const name of ['node:http','node:https']){const api=require(name);api.request=api.get=deny}
const net=require('node:net');net.connect=net.createConnection=net.Socket.prototype.connect=deny;
require('node:tls').connect=deny;
const child=require('node:child_process');for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync'])child[key]=deny;
const promises=require('node:fs/promises'),open=promises.open;
promises.open=async(...args)=>{
 const file=await open(...args);
 if(String(args[0])===process.env.ZM_PLATFORM_RACE){fs.renameSync(args[0],args[0]+'.before-race');fs.writeFileSync(args[0],'private replacement bytes must not be read')}
 if(String(args[0])===process.env.ZM_PLATFORM_CANCEL){fs.writeFileSync(process.env.ZM_PLATFORM_CANCEL_MARKER,'injected');process.emit('SIGINT')}
 return file;
};
mod.syncBuiltinESMExports();
`,
)
const prefix = ["--no-addons", "--require", guard]
const entry = join(packageRoot, "dist", "bin", "zm.js")
const diagnostics = (text) =>
  text.replace(
    /\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n(?:\(Use .+?\r?\n)?/g,
    "",
  )
const checks = []
const invoke = (args, status = 0, extra = {}) => {
  const result = spawnSync(process.execPath, [...prefix, entry, ...args], {
    cwd: root,
    env: { ...environment, ...extra },
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, status, `${args.join(" ")}: ${result.stderr}`)
  assert.equal(existsSync(denied), false, "network, browser or keyring accessed")
  assert.equal(existsSync(loaded), true, "guard not loaded")
  if (status === 0) assert.equal(diagnostics(result.stderr), "")
  else {
    assert.equal(result.stdout, "")
    assert.ok(result.stderr)
  }
  checks.push({ args, status })
  return result
}
const json = (...args) => JSON.parse(invoke(["--json", ...args]).stdout)
assert.equal(invoke(["--version"]).stdout.trim(), expectedVersion)
invoke(["--help"])
json("commands")
assert.equal(existsSync(environment.ZM_CONFIG_DIR), false)
assert.equal(existsSync(environment.MESSAGING_STORE), false)
json("config", "set", "account.profile", "invented-platform")
const folder = join(sandbox, "vtt")
mkdirSync(folder)
const vtt = join(folder, "2026-10-10_1530_example.vtt")
const original = "WEBVTT\n\n00:00.000 --> 00:01.000\nAlice Example: Original invented plan\n"
writeFileSync(vtt, original)
json("import", folder)
json("import", folder)
const meetings = json("meetings", "list").items
assert.equal(meetings.length, 1)
const meetingId = String(meetings[0].id)
writeFileSync(vtt, original.replace("Original", "Corrected"))
json("import", folder)
assert.equal(json("meetings", "show", meetingId).transcripts.length, 2)
assert.equal(json("meetings", "search", "Original").items.length, 0)
assert.equal(json("meetings", "search", "Corrected").items.length, 1)
assert.equal(json("meetings", "transcript", meetingId).items.length, 1)
assert.equal(json("meetings", "transcript", meetingId, "--history").items.length, 2)
const exported = join(sandbox, "exported.vtt")
json("meetings", "export", meetingId, "--format", "vtt", "--output", exported)
assert.ok(readFileSync(exported, "utf8").includes("Corrected invented plan"))
invoke(["meetings", "export", meetingId, "--format", "vtt", "--output", exported], 2)
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const archive = join(sandbox, "archive")
mkdirSync(archive)
const uuid = "example-platform-occurrence",
  fileId = "example-platform-asset"
const relative = `${digest(uuid)}-${digest(fileId)}.vtt`
const asset = join(archive, relative)
writeFileSync(asset, original)
writeFileSync(
  join(archive, `.zoom-archive-${digest(uuid)}.json`),
  JSON.stringify({
    version: 1,
    meeting: { id: "123456", uuid, title: "Example archive", startedAt: null },
    files: [
      {
        id: fileId,
        path: relative,
        size: Buffer.byteLength(original),
        sha256: digest(original),
        remoteSize: null,
        type: "audio_transcript",
        format: "vtt",
        startedAt: null,
        endedAt: null,
      },
    ],
  }),
)
const probeFile = await open(asset, "r")
try {
  const stats = [
    await lstat(asset, { bigint: true }),
    await probeFile.stat({ bigint: true }),
    await lstat(asset, { bigint: true }),
  ]
  console.log(
    JSON.stringify({
      platformIdentityProbe: stats.map((stat) => ({ dev: String(stat.dev), ino: String(stat.ino) })),
      node: process.version,
    }),
  )
} finally {
  await probeFile.close()
}
assert.equal(json("recordings", "archive", "transcript", archive).items[0].cues[0].text, "Original invented plan")
assert.equal(
  json("recordings", "archive", "search", archive, "invented", "--uuid", uuid, "--file-ids", fileId).items.length,
  1,
)
invoke(["recordings", "archive", "transcript", archive, "--json"], 2, { ZM_PLATFORM_RACE: asset })
assert.equal(readFileSync(asset, "utf8"), "private replacement bytes must not be read")
renameSync(asset, `${asset}.replacement`)
renameSync(`${asset}.before-race`, asset)
renameSync(asset, `${asset}.original`)
symlinkSync(`${asset}.original`, asset, "file")
invoke(["recordings", "archive", "transcript", archive, "--json"], 2)
unlinkSync(asset)
renameSync(`${asset}.original`, asset)
const cancelMarker = join(sandbox, "cancel-injected")
invoke(["recordings", "archive", "transcript", archive, "--json"], 130, {
  ZM_PLATFORM_CANCEL: asset,
  ZM_PLATFORM_CANCEL_MARKER: cancelMarker,
})
assert.equal(existsSync(cancelMarker), true)
const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href)
const { StdioServerTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/stdio.js")).href
)
const child = spawn(process.execPath, [...prefix, entry, "serve", "--mcp"], {
  cwd: root,
  env: environment,
  stdio: ["pipe", "pipe", "pipe"],
})
let stderr = ""
child.stderr.on("data", (bytes) => {
  stderr += bytes
})
const exited = new Promise((resolveExit, reject) => {
  child.once("error", reject)
  child.once("close", resolveExit)
})
const timer = setTimeout(() => child.kill(), 15000)
const client = new Client({ name: "invented-platform-proof", version: "1" })
try {
  await client.connect(new StdioServerTransport(child.stdout, child.stdin))
  assert.equal((await client.listTools()).tools.length, 7)
  const result = await client.callTool({ name: "meetings_list", arguments: {} })
  assert.notEqual(result.isError, true)
  child.stdin.end()
  assert.equal(await exited, 0, stderr)
  assert.equal(diagnostics(stderr), "")
} finally {
  clearTimeout(timer)
  await client.close()
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await exited
}
assert.equal(existsSync(denied), false)
const proof = {
  platform: process.platform,
  node: process.version,
  packageVersion: expectedVersion,
  meetingsCopies: 1,
  checks,
  mcp: true,
  externalAccess: false,
}
writeFileSync(join(root, "proof.json"), JSON.stringify(proof, null, 2))
console.log(JSON.stringify(proof))
