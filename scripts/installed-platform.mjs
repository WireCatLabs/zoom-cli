import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(process.argv[2])
const expectedVersion = process.argv[3]
assert.ok(expectedVersion, "provide an isolated install directory and package version")
const packageRoot = join(root, "node_modules", "@wirecat", "zoom-cli")
const metadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
assert.equal(metadata.version, expectedVersion)
const require = createRequire(join(packageRoot, "package.json"))
const producerRequire = createRequire(require.resolve("@wirecat/cli-core"))
assert.equal(require.resolve("@wirecat/cli-base"), producerRequire.resolve("@wirecat/cli-base"))
const dependencyVersion = (name) => {
  let directory = dirname(require.resolve(name))
  while (directory !== dirname(directory)) {
    const file = join(directory, "package.json")
    if (existsSync(file)) {
      const item = JSON.parse(readFileSync(file, "utf8"))
      if (item.name === name) return item.version
    }
    directory = dirname(directory)
  }
  throw new Error(`installed dependency metadata missing: ${name}`)
}
const dependencies = {
  messaging: dependencyVersion("@wirecat/cli-core"),
  core: dependencyVersion("@wirecat/cli-base"),
}
const declared = (name) => metadata.dependencies[name] ?? metadata.peerDependencies?.[name]
assert.deepEqual(dependencies, {
  messaging: declared("@wirecat/cli-core"),
  core: declared("@wirecat/cli-base"),
})
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
  WIRECAT_STATE_DIR: join(sandbox, "wirecat-state"),
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
const fetch=globalThis.fetch;
globalThis.fetch=(input,...args)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(process.env.ZM_PLATFORM_MODEL_ORIGIN&&url.origin===process.env.ZM_PLATFORM_MODEL_ORIGIN&&url.pathname==='/v1/embeddings')return fetch(input,...args);return deny()};
for(const name of ['node:http','node:https']){const api=require(name);api.request=api.get=deny}
const net=require('node:net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const input=Array.isArray(args[0])?args[0][0]:args[0];if(process.env.ZM_PLATFORM_MODEL_ORIGIN&&typeof input==='object'&&input!==null&&input.host==='127.0.0.1'&&String(input.port)===new URL(process.env.ZM_PLATFORM_MODEL_ORIGIN).port)return connect.apply(this,args);return deny()};
net.connect=net.createConnection=function(...args){return new net.Socket().connect(...args)};
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
const prefix = [...(process.versions.bun ? [] : ["--no-addons"]), "--require", guard]
const entry = join(packageRoot, "dist", "bin", "zm.js")
const diagnostics = (text) =>
  text.replace(
    /\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n(?:\(Use .+?\r?\n)?/g,
    "",
  )
const checks = []
const invoke = (args, status = 0, extra = {}, input) => {
  const result = spawnSync(process.execPath, [...prefix, entry, ...args], {
    cwd: root,
    input,
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
const {
  itemEnvelopeSchema,
  listEnvelopeSchema,
  jsonlItemSchema,
  jsonlEndSchema,
} = require("@wirecat/cli-base/standards")
const v = require("valibot")
const envelope = v.union([itemEnvelopeSchema(v.unknown()), listEnvelopeSchema(v.unknown())])
const answer = (text) => {
  const packet = JSON.parse(text)
  if (Object.hasOwn(packet, "commands")) return packet
  v.parse(envelope, packet)
  return Object.hasOwn(packet, "item") ? packet.item : packet
}
const jsonl = (text) => {
  const records = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(records.at(-1).type, "end")
  for (const record of records) v.parse(record.type === "item" ? jsonlItemSchema(v.unknown()) : jsonlEndSchema, record)
  assert.equal(records.filter((record) => record.type === "end").length, 1)
  return records.filter((record) => record.type === "item").map((record) => record.data)
}
const json = (...args) => answer(invoke(["--json", ...args]).stdout)
assert.equal(invoke(["--version"]).stdout.trim(), expectedVersion)
invoke(["--help"])
json("commands")
invoke(["--json", "meetings", "prepare", "123", "--cues", "101"], 2)
const invalidBatch = join(sandbox, "invalid-batch.json")
writeFileSync(invalidBatch, '{"requests":[{"id":"write","command":["meetings","sync"],"args":[]}]}')
invoke(["batch", invalidBatch, "--json"], 2)
invoke(["batch", "-", "--json"], 2, {}, Buffer.from([0xff]))
invoke(["batch", "-", "--json"], 2, {}, " ".repeat(262145))
assert.equal(existsSync(environment.ZM_CONFIG_DIR), false)
assert.equal(existsSync(environment.MESSAGING_STORE), false)
const missingProfileArchive = join(sandbox, "missing-profile-archive")
invoke(["recordings", "download", "example-occurrence", "--output-dir", missingProfileArchive, "--resume", "--json"], 2)
invoke(
  [
    "recordings",
    "sync",
    "--since-time",
    "2026-10-01",
    "--until-time",
    "2026-10-11",
    "--output-dir",
    missingProfileArchive,
    "--resume",
    "--jsonl",
  ],
  2,
)
assert.equal(existsSync(missingProfileArchive), false)
environment.ZM_PROFILE = "invented-platform"
json("config", "set", "zoom.client_id", "example-public-client")
const scheduleArchive = join(sandbox, "scheduled-archive")
const schedulePreview = json(
  "recordings",
  "schedule",
  "create",
  "--name",
  "Alice Example backup",
  "--output-dir",
  scheduleArchive,
  "--since-time",
  "2026-10-01",
  "--at",
  "03:15",
  "--timezone",
  "Europe/Madrid",
  "--lookback-days",
  "7",
  "--max-bytes",
  "1024",
  "--yes",
  "--dry-run",
  "--offline",
)
assert.equal(schedulePreview.applied, false)
assert.equal(schedulePreview.timer_state, "not_checked")
assert.equal(schedulePreview.job.capture.profile, "invented-platform")
assert.equal(schedulePreview.job.capture.client_id, "example-public-client")
assert.deepEqual(json("recordings", "schedule", "list", "--offline").items, [])
invoke(["recordings", "schedule", "show", schedulePreview.job.schedule.id, "--offline", "--json"], 6)
invoke(["recordings", "schedule", "disable", schedulePreview.job.schedule.id, "--dry-run", "--offline", "--json"], 6)
for (const [path, flags] of [
  [
    ["recordings", "download", "example-occurrence"],
    ["--file-ids", " "],
  ],
  [
    ["recordings", "sync", "--since-time", "2026-10-01", "--until-time", "2026-10-11", "--jsonl"],
    ["--max-pages", "10001"],
  ],
  [
    ["recordings", "sync", "--since-time", "2026-10-01", "--until-time", "2026-10-11", "--jsonl"],
    ["--checkpoint", join(sandbox, "contradictory-checkpoint"), "--no-resume"],
  ],
])
  invoke([...path, "--output-dir", scheduleArchive, ...flags], 2)
assert.equal(existsSync(scheduleArchive), false)
assert.equal(existsSync(join(environment.ZM_CONFIG_DIR, "recording-schedules")), false)
assert.equal(existsSync(join(environment.XDG_CONFIG_HOME, "systemd", "user")), false)
const resumeHelper = fileURLToPath(new URL("./installed-recording-resume.mjs", import.meta.url))
const recordingResume = []
for (const [phase, destination] of [
  ["full", join(sandbox, "full-download")],
  ["fail", join(sandbox, "resumed-download")],
  ["resume", join(sandbox, "resumed-download")],
]) {
  const result = spawnSync(process.execPath, [...prefix, resumeHelper, root, destination, phase], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, `installed recording ${phase}: ${result.stderr}`)
  assert.equal(diagnostics(result.stderr), "")
  assert.equal(existsSync(denied), false, "installed resume accessed external IO")
  recordingResume.push(JSON.parse(result.stdout))
}
const writerLeaseResult = spawnSync(
  process.execPath,
  [...prefix, fileURLToPath(new URL("./installed-writer-leases.mjs", import.meta.url)), root],
  {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  },
)
assert.equal(writerLeaseResult.error, undefined)
assert.equal(writerLeaseResult.status, 0, `installed writer leases: ${writerLeaseResult.stderr}`)
assert.equal(diagnostics(writerLeaseResult.stderr), "")
assert.equal(existsSync(denied), false, "installed writer leases accessed external IO")
const writerLeaseProof = JSON.parse(writerLeaseResult.stdout)
const partialResult = spawnSync(
  process.execPath,
  [...prefix, fileURLToPath(new URL("./installed-recording-partials.mjs", import.meta.url)), root],
  { cwd: root, env: environment, encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
)
assert.equal(partialResult.error, undefined)
assert.equal(partialResult.status, 0, `installed recording partials: ${partialResult.stderr}`)
assert.equal(diagnostics(partialResult.stderr), "")
assert.equal(existsSync(denied), false, "installed recording partials accessed external IO")
const partialProof = JSON.parse(partialResult.stdout)
const publicationResult = spawnSync(
  process.execPath,
  [...prefix, fileURLToPath(new URL("./installed-recording-publication.mjs", import.meta.url)), root],
  { cwd: root, env: environment, encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
)
assert.equal(publicationResult.error, undefined)
assert.equal(publicationResult.status, 0, `installed recording publication: ${publicationResult.stderr}`)
assert.equal(diagnostics(publicationResult.stderr), "")
assert.equal(existsSync(denied), false, "installed recording publication accessed external IO")
const publicationProof = JSON.parse(publicationResult.stdout)
const upcomingResult = spawnSync(
  process.execPath,
  [...prefix, fileURLToPath(new URL("./installed-upcoming.mjs", import.meta.url)), root],
  {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  },
)
assert.equal(upcomingResult.error, undefined)
assert.equal(upcomingResult.status, 0, `installed upcoming SDK: ${upcomingResult.stderr}`)
assert.equal(diagnostics(upcomingResult.stderr), "")
assert.equal(existsSync(denied), false)
const upcomingProof = JSON.parse(upcomingResult.stdout)
const preparationResult = spawnSync(
  process.execPath,
  [...prefix, fileURLToPath(new URL("./installed-preparation.mjs", import.meta.url)), root],
  { cwd: root, env: environment, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 },
)
assert.equal(preparationResult.error, undefined)
assert.equal(preparationResult.status, 0, `installed preparation SDK: ${preparationResult.stderr}`)
assert.equal(diagnostics(preparationResult.stderr), "")
assert.equal(existsSync(denied), false)
const preparationProof = JSON.parse(preparationResult.stdout)
const folder = join(sandbox, "vtt")
mkdirSync(folder)
const vtt = join(folder, "2026-10-10_1530_example.vtt")
const original = "WEBVTT\n\n00:00.000 --> 00:01.000\nAlice Example: Original invented plan\n"
writeFileSync(vtt, original)
json("meetings", "import", folder)
json("meetings", "import", folder)
const meetings = json("meetings", "list").items
assert.equal(meetings.length, 1)
assert.equal(typeof meetings[0].id, "string")
const meetingId = String(meetings[0].id)
writeFileSync(vtt, original.replace("Original", "Corrected"))
json("meetings", "import", folder)
assert.equal(json("meetings", "show", meetingId).transcripts.length, 1)
assert.equal(json("meetings", "transcript", meetingId, "--history").items.length, 2)
assert.equal(json("search", "meetings", "Original").items.length, 0)
assert.equal(json("search", "meetings", "Corrected").items.length, 1)
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
    meeting: { id: "123456", uuid, title: "Example archive", startedAt: "2026-10-10T16:30:00.000Z" },
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
assert.equal(json("search", "recordings", archive, "invented").items.length, 1)
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
// Actual installed append APIs: replay deduplication and correction history survive process boundaries.
const imported = json("recordings", "archive", "import", archive).items[0]
assert.equal(imported.status, "acknowledged")
assert.equal(imported.created, true)
assert.equal(imported.inserted_transcripts, 1)
assert.equal(imported.replayed_transcripts, 0)
assert.equal(imported.superseded_transcripts, 0)
const archivedMeetingId = String(imported.meeting_id)
const importedReplay = json("recordings", "archive", "import", archive).items[0]
assert.equal(importedReplay.meeting_id, imported.meeting_id)
assert.equal(importedReplay.created, false)
assert.equal(importedReplay.inserted_transcripts, 0)
assert.equal(importedReplay.replayed_transcripts, 1)
assert.equal(importedReplay.superseded_transcripts, 0)
assert.equal(json("meetings", "show", archivedMeetingId).transcripts.length, 1)
const manifestPath = join(archive, `.zoom-archive-${digest(uuid)}.json`)
const correctedArchive = original.replace("Original", "Revised archive")
writeFileSync(asset, correctedArchive)
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
manifest.files[0].size = Buffer.byteLength(correctedArchive)
manifest.files[0].sha256 = digest(correctedArchive)
writeFileSync(manifestPath, JSON.stringify(manifest))
const correctedReceipt = json("recordings", "archive", "import", archive).items[0]
assert.equal(correctedReceipt.created, false)
assert.equal(correctedReceipt.inserted_transcripts, 1)
assert.equal(correctedReceipt.replayed_transcripts, 0)
assert.equal(correctedReceipt.superseded_transcripts, 1)
json("recordings", "archive", "import", archive)
assert.equal(json("meetings", "show", archivedMeetingId).transcripts.length, 1)
assert.equal(json("meetings", "transcript", archivedMeetingId, "--history").items.length, 2)
assert.equal(json("search", "meetings", "Original").items.length, 0)
assert.equal(json("search", "meetings", "Revised archive").items.length, 1)
assert.equal(json("meetings", "show", meetingId).transcripts.length, 1)
assert.equal(
  json("meetings", "transcript", meetingId, "--history").items.length,
  2,
  "append preserves unrelated history",
)
// Seed a distinct account, then name the initial profile again before the MCP process starts.
environment.ZM_PROFILE = "invented-foreign-platform"
writeFileSync(vtt, original.replace("Original invented plan", "Foreign invented boundary"))
json("meetings", "import", folder)
const foreignMeetingId = String(json("meetings", "list").items[0].id)
assert.notEqual(foreignMeetingId, meetingId)
environment.ZM_PROFILE = "invented-platform"
const { installedMeetingIntegration } = await import("./installed-meeting-integration.mjs")
const meetingIntegration = await installedMeetingIntegration({
  root,
  sandbox,
  environment,
  prefix,
  json,
  invoke,
  diagnostics,
})
const people = json("meetings", "people", "Alice", "--limit", "1", "--scan-limit", "100", "--max-read-bytes", "10000")
assert.equal(people.items.length, 1)
assert.equal(typeof people.items[0].identity_id, "number")
assert.notEqual(String(people.items[0].meeting_id), foreignMeetingId)
assert.equal(people.coverage.archive_completeness, "unknown")
assert.equal(people.page.limit, 1)
assert.equal(people.page.has_more, true)
assert.equal(people.next[0].step, "page.next")
const peopleJsonl = invoke([
  "meetings",
  "people",
  "Alice",
  "--limit",
  "1",
  "--cursor",
  people.page.next_cursor,
  "--jsonl",
])
assert.equal(peopleJsonl.stdout.trim().split("\n").length, 2)
const [peopleContinuation] = jsonl(peopleJsonl.stdout)
assert.ok(peopleContinuation.items.every((item) => String(item.meeting_id) !== foreignMeetingId))
assert.equal(typeof peopleContinuation.page.has_more, "boolean")
// The installed package ships no MCP client, so the proof speaks newline-delimited JSON-RPC itself.
const child = spawn(process.execPath, [...prefix, entry, "invented-platform", "mcp"], {
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
const pending = new Map()
let buffered = ""
child.stdout.on("data", (bytes) => {
  buffered += bytes
  for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
    const message = JSON.parse(buffered.slice(0, end))
    buffered = buffered.slice(end + 1)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  }
})
let nextId = 0
const rpc = (method, params) =>
  new Promise((resolveReply) => {
    const id = ++nextId
    pending.set(id, resolveReply)
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  })
const callTool = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result
try {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "invented-platform-proof", version: "1" },
  })
  assert.ok(initialized.result.capabilities.tools)
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
  const tools = (await rpc("tools/list", {})).result.tools
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["zm_tools_search", "zm_read", "zm_write"],
  )
  const projectEvidence = await callTool("zm_read", {
    command: "meetings projects evidence",
    arguments: { project: "RES", limit: 2 },
  })
  assert.notEqual(projectEvidence.isError, true, JSON.stringify(projectEvidence))
  assert.equal(projectEvidence.structuredContent.item.project.key, "RES")
  assert.equal(projectEvidence.structuredContent.item.association, "unconfirmed-word-evidence")
  assert.equal(projectEvidence.structuredContent.item.coverage.archive_completeness, "unknown")
  assert.equal(projectEvidence.structuredContent.item.page.has_more, true)
  assert.equal(typeof projectEvidence.structuredContent.meta.run_id, "string")
  const refusedScope = await callTool("zm_read", {
    command: "meetings projects evidence",
    arguments: { project: "RES", account_id: 999 },
  })
  assert.equal(refusedScope.isError, true)
  const result = await callTool("zm_read", { command: "meetings list", arguments: {} })
  assert.notEqual(result.isError, true, JSON.stringify(result))
  const firstScope = result.structuredContent
  assert.ok(firstScope.items.some((meeting) => String(meeting.id) === meetingId))
  assert.equal(
    firstScope.items.some((meeting) => String(meeting.id) === foreignMeetingId),
    false,
  )
  environment.ZM_PROFILE = "invented-foreign-platform"
  assert.ok(json("meetings", "list").items.some((meeting) => String(meeting.id) === foreignMeetingId))
  const secondResult = await callTool("zm_read", { command: "meetings list", arguments: {} })
  assert.notEqual(secondResult.isError, true)
  const secondScope = secondResult.structuredContent
  assert.deepEqual(
    secondScope.items,
    firstScope.items,
    "a running MCP server keeps its profile when later commands name another profile",
  )
  assert.notEqual(secondScope.meta.run_id, firstScope.meta.run_id)

  child.stdin.end()
  assert.equal(await exited, 0, stderr)
  assert.equal(diagnostics(stderr), "")
} finally {
  clearTimeout(timer)
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await exited
}
assert.equal(existsSync(denied), false)
environment.ZM_PROFILE = "invented-platform"
// A separate fixture process answers synchronous CLI children. Only its exact loopback endpoint
// is allowed by the runtime guard; no credentials, real model, Zoom or internet are involved.
const modelServer = join(root, "model-server.cjs")
const modelRequests = join(root, "model-requests.jsonl")
writeFileSync(
  modelServer,
  `
const http=require('node:http'),fs=require('node:fs');
const server=http.createServer((request,response)=>{
 if(request.method!=='POST'||request.url!=='/v1/embeddings'||request.headers.authorization){response.writeHead(400);response.end();return}
 let body='';request.setEncoding('utf8');request.on('data',part=>body+=part);
 request.on('end',()=>{const input=JSON.parse(body);fs.appendFileSync(process.env.ZM_PLATFORM_MODEL_REQUESTS,JSON.stringify(input)+'\\n');response.setHeader('content-type','application/json');response.end(JSON.stringify({data:input.input.map((text,index)=>({index,embedding:[1,0.5]}))}))});
});server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));
`,
)
const modelChild = spawn(process.execPath, [modelServer], {
  cwd: root,
  env: { ...environment, ZM_PLATFORM_MODEL_REQUESTS: modelRequests },
  stdio: ["ignore", "pipe", "pipe"],
})
const modelExited = new Promise((resolveExit, reject) => {
  modelChild.once("error", reject)
  modelChild.once("close", resolveExit)
})
let modelStderr = ""
modelChild.stderr.on("data", (bytes) => {
  modelStderr += bytes
})
const modelTimer = setTimeout(() => modelChild.kill(), 15000)
try {
  const port = await new Promise((resolvePort, reject) => {
    let text = ""
    modelChild.stdout.on("data", (bytes) => {
      text += bytes
      if (text.includes("\n")) resolvePort(text.trim())
    })
    modelChild.once("error", reject)
    modelChild.once("close", () => reject(new Error(`fixture model exited: ${modelStderr}`)))
  })
  assert.match(port, /^[0-9]+$/)
  clearTimeout(modelTimer)
  const origin = `http://127.0.0.1:${port}`
  const modelOptions = ["--model", "invented-platform-model", "--base-url", `${origin}/v1`, "--dims", "2"]
  const remoteEnvironment = { ZM_PLATFORM_MODEL_ORIGIN: origin }
  const remoteJson = (...args) => answer(invoke(["--json", ...args], 0, remoteEnvironment).stdout)
  const requests = () =>
    existsSync(modelRequests)
      ? readFileSync(modelRequests, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : []
  const preview = remoteJson("meetings", "embeddings", ...modelOptions)
  assert.equal(preview.applied, false)
  assert.deepEqual(preview.status, { chunks: 0, embedded: 0 })
  assert.equal(requests().length, 0, "preview must not open a model or call the embedding endpoint")
  for (const args of [
    ["search", "meetings", "invented", ...modelOptions],
    ["meetings", "embeddings", ...modelOptions, "--yes"],
  ])
    invoke(["--offline", ...args], 3, remoteEnvironment)
  assert.equal(requests().length, 0, "offline semantic commands must fail before model HTTP")
  assert.deepEqual(remoteJson("meetings", "embeddings", ...modelOptions).status, preview.status)
  const generated = remoteJson("meetings", "embeddings", ...modelOptions, "--yes")
  assert.equal(generated.applied, true)
  assert.ok(generated.saved > 0)
  const generatedRequests = requests().length
  assert.ok(generatedRequests > 0)
  const status = remoteJson("meetings", "embeddings", ...modelOptions).status
  assert.ok(status.chunks > 0)
  assert.equal(status.embedded, status.chunks)
  assert.equal(requests().length, generatedRequests, "preview remains model-free with populated chunks")
  const query = "invented selected-profile semantic question"
  const semantic = remoteJson("search", "meetings", query, ...modelOptions)
  assert.ok(semantic.items.length > 0)
  assert.ok(semantic.items.every((hit) => String(hit.meeting_id) !== foreignMeetingId))
  assert.ok(semantic.items.every((hit) => /^meeting:[1-9][0-9]*\/[1-9][0-9]*\/[1-9][0-9]*$/.test(hit.reference)))
  assert.ok(semantic.items.every((hit) => hit.first_cue_reference.startsWith(`${hit.reference}/`)))
  assert.equal(semantic.coverage.scope, "current-indexed-vectors")
  assert.equal(semantic.coverage.index_completeness, "unknown")
  assert.equal(semantic.coverage.archive_completeness, "unknown")
  assert.equal(requests().length, generatedRequests + 1)
  assert.deepEqual(requests().at(-1).input, [query], "semantic read embeds only the explicit query")
  assert.deepEqual(remoteJson("meetings", "embeddings", ...modelOptions).status, status)
  const replay = remoteJson("meetings", "embeddings", ...modelOptions, "--yes")
  assert.equal(replay.saved, 0)
  assert.equal(requests().length, generatedRequests + 1, "cached generation must not call the model")
} finally {
  clearTimeout(modelTimer)
  if (modelChild.exitCode === null && modelChild.signalCode === null) modelChild.kill()
  await modelExited
}
assert.equal(modelStderr, "")
assert.equal(existsSync(denied), false)
const proof = {
  platform: process.platform,
  node: process.version,
  packageVersion: expectedVersion,
  coreCopies: 1,
  dependencies,
  checks,
  mcp: true,
  archiveAppend: true,
  fixedMcpProfile: true,
  semanticPreviewGenerationQuery: true,
  semanticOfflineBoundary: true,
  scheduleOfflinePreview: true,
  recordingResume,
  writer_leases: writerLeaseProof,
  native_partials: partialProof,
  native_publication: publicationProof,
  upcoming_sdk: upcomingProof,
  preparation_sdk: preparationProof,
  meetingIntegration,
  modelEndpoint: "isolated loopback fixture only",
  externalAccess: false,
}
writeFileSync(join(root, "proof.json"), JSON.stringify(proof, null, 2))
console.log(JSON.stringify(proof))
