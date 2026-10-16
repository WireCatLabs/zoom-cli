import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(process.argv[2])
const require = createRequire(join(root, "node_modules/@wirecat/zoom-cli/package.json"))
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { NativeRecordingPartialStore } = await load("@wirecat/cli-core/persistence/native")
const { transferRecording } = await load("@wirecat/cli-core/meetings")
const { ZoomRecordings, verifyArchive } = await load("@wirecat/zoom-cli")
const digest = (value) => createHash("sha256").update(value).digest("hex")
const locator = { provider: "example-calls", account: "AliceExample", occurrenceId: "weekly", assetId: "audio" }
const settings = { prefix: ".example-partial-", persistent: true, maxBytes: 100 }
const folder = join(root, "shared-native-partials")
await mkdir(folder)
const first = new NativeRecordingPartialStore(folder, locator, settings)
const writer = await first.open(locator, { validator: '"example-v1"', total: 6 })
try {
  await writer.write(Buffer.from("abc"))
  await writer.checkpoint()
} finally {
  await writer.close()
}
await appendFile(first.path, "uncommitted")
const second = new NativeRecordingPartialStore(folder, locator, settings)
const receipt = await transferRecording(
  {
    open: async (request) => {
      assert.equal(request.offset, 3)
      assert.equal(request.validator, '"example-v1"')
      return {
        status: 206,
        etag: '"example-v1"',
        contentRange: "bytes 3-5/6",
        contentLength: "3",
        body: (async function* () {
          yield Buffer.from("def")
        })(),
        close: async () => {},
      }
    },
  },
  second,
  { locator, maxBytes: 100 },
)
assert.deepEqual(receipt, { size: 6, sha256: digest("abcdef"), resumedBytes: 3 })
assert.equal(await readFile(second.path, "utf8"), "abcdef")
const destination = join(root, "legacy-zoom-native-partials")
await mkdir(destination)
const zoomLocator = {
  provider: "zoom",
  account: "AliceExample",
  occurrenceId: "example-native-partial",
  assetId: "example-video",
}
const key = digest(JSON.stringify(Object.values(zoomLocator)))
await writeFile(join(destination, `.zoom-partial-${key}.part`), "abc")
await writeFile(
  join(destination, `.zoom-partial-${key}.json`),
  JSON.stringify({
    locator: zoomLocator,
    offset: 3,
    sha256: digest("abc"),
    validator: '"example-v1"',
    total: 6,
  }),
)
const tokens = {
  tokens: async () => ({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: 3600000,
    scopes: ["cloud_recording:read:list_user_recordings", "cloud_recording:read:list_recording_files"],
  }),
}
let downloads = 0
const source = new ZoomRecordings(tokens, async (input, init) => {
  const url = new URL(String(input))
  if (url.origin === "https://api.zoom.us")
    return new Response(
      JSON.stringify({
        id: 123456,
        uuid: zoomLocator.occurrenceId,
        topic: "Example native partial",
        recording_files: [
          {
            id: zoomLocator.assetId,
            file_extension: "MP4",
            recording_type: "shared_screen",
            status: "completed",
            file_size: 6,
            download_url: "https://zoom.us/example-partial-download",
          },
        ],
      }),
    )
  assert.equal(url.origin, "https://zoom.us")
  assert.equal(new Headers(init?.headers).get("range"), "bytes=3-")
  assert.equal(new Headers(init?.headers).get("if-range"), '"example-v1"')
  downloads++
  return new Response("def", {
    status: 206,
    headers: { "content-length": "3", "content-range": "bytes 3-5/6", etag: '"example-v1"' },
  })
})
const report = await source.download(zoomLocator.occurrenceId, { destination, account: zoomLocator.account })
assert.equal(downloads, 1)
assert.equal(report.downloaded.length, 1)
assert.equal(await readFile(join(destination, report.downloaded[0].path), "utf8"), "abcdef")
assert.equal((await verifyArchive(destination))[0].valid, true)
console.log(
  JSON.stringify({
    shared_native_partials: true,
    second_provider: true,
    legacy_zoom_checkpoint: true,
    exact_prefix_resume: true,
    trailing_bytes_recovered: true,
    verified_archive: true,
  }),
)
