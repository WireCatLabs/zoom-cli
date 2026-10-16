import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { link, mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(process.argv[2])
const require = createRequire(join(root, "node_modules/@wirecat/zoom-cli/package.json"))
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { NativeRecordingPublication } = await load("@wirecat/cli-core/persistence/native")
const { ZoomRecordings, verifyArchive } = await load("@wirecat/zoom-cli")
const digest = (value) => createHash("sha256").update(value).digest("hex")
const folder = join(root, "native-publication")
await mkdir(folder)
const locator = { provider: "example-calls", account: "AliceExample", occurrenceId: "weekly", assetId: "audio" }
const evidence = { size: 6, sha256: digest("abcdef"), validator: '"example-v1"' }
const publication = new NativeRecordingPublication(folder, locator, {
  prefix: ".example-promotion-",
  filename: "audio.bin",
  maxBytes: 100,
  metadataLimit: 1024,
  codec: {
    encode: JSON.stringify,
    decode: (value) => {
      assert.deepEqual(value, evidence)
      return value
    },
  },
  evidence: (value) => value,
})
const partial = join(folder, "owned.part")
await writeFile(partial, "abcdef")
await publication.write(evidence)
await assert.rejects(
  publication.publish(partial, evidence, async () => {
    throw new Error("example interruption")
  }),
  /example interruption/,
)
let committed = false
await publication.recover(
  partial,
  async () => ({ locator, offset: 6, sha256: evidence.sha256, validator: evidence.validator, total: 6 }),
  async () => {
    committed = true
  },
)
assert.equal(committed, true)
assert.equal(await readFile(publication.finalPath, "utf8"), "abcdef")
await assert.rejects(readFile(partial), { code: "ENOENT" })
await writeFile(partial, "abcdef")
await assert.rejects(
  publication.publish(partial, evidence, async () => {
    throw new Error("must not commit")
  }),
  { code: "EEXIST" },
)
assert.equal(await readFile(publication.finalPath, "utf8"), "abcdef")

const destination = join(root, "legacy-zoom-publication")
await mkdir(destination)
const zoomLocator = {
  provider: "zoom",
  account: "AliceExample",
  occurrenceId: "example-native-publication",
  assetId: "example-video",
}
const key = digest(JSON.stringify(Object.values(zoomLocator)))
const finalName = `${digest(zoomLocator.occurrenceId)}-${digest(zoomLocator.assetId)}.mp4`
const partialPath = join(destination, `.zoom-partial-${key}.part`)
const meeting = { id: "123456", uuid: zoomLocator.occurrenceId, title: "Example native publication", startedAt: null }
const file = {
  id: zoomLocator.assetId,
  path: finalName,
  size: 6,
  sha256: evidence.sha256,
  remoteSize: 6,
  type: "shared_screen",
  format: "MP4",
  startedAt: null,
  endedAt: null,
}
await writeFile(partialPath, "abcdef")
await writeFile(
  join(destination, `.zoom-partial-${key}.json`),
  JSON.stringify({ locator: zoomLocator, offset: 6, sha256: evidence.sha256, validator: evidence.validator, total: 6 }),
)
await writeFile(
  join(destination, `.zoom-promotion-${key}.json`),
  JSON.stringify({ version: 1, locator: zoomLocator, meeting, file, validator: evidence.validator }),
)
await link(partialPath, join(destination, finalName))
const tokens = {
  tokens: async () => ({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: 3600000,
    scopes: ["cloud_recording:read:list_user_recordings", "cloud_recording:read:list_recording_files"],
  }),
}
const source = new ZoomRecordings(tokens, async (input) => {
  const url = new URL(String(input))
  assert.equal(url.origin, "https://api.zoom.us", "recovery must not download")
  return new Response(
    JSON.stringify({
      id: 123456,
      uuid: meeting.uuid,
      topic: meeting.title,
      recording_files: [
        {
          id: zoomLocator.assetId,
          file_extension: "MP4",
          recording_type: "shared_screen",
          status: "completed",
          file_size: 6,
          download_url: "https://zoom.us/example-publication-download",
        },
      ],
    }),
  )
})
const report = await source.download(meeting.uuid, { destination, account: zoomLocator.account })
assert.equal(report.downloaded.length, 0)
assert.deepEqual(report.skipped, [file])
assert.equal((await verifyArchive(destination))[0].valid, true)
await assert.rejects(readFile(partialPath), { code: "ENOENT" })
console.log(
  JSON.stringify({
    shared_native_publication: true,
    second_provider: true,
    no_overwrite: true,
    interrupted_commit_recovered: true,
    independent_legacy_zoom_journal: true,
    verified_archive: true,
  }),
)
