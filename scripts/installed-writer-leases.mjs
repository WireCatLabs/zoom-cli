import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { hostname } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(process.argv[2])
const require = createRequire(join(root, "node_modules/@wirecat/zoom-cli/package.json"))
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { ZoomRecordings, inspectArchiveLocks, recoverArchiveLocks, verifyArchive } = await load("@wirecat/zoom-cli")
const { nativeWriterLeaseStore } = await load("@wirecat/cli-core/files")
const destination = join(root, "shared-writer-archive")
await mkdir(destination)
const leases = nativeWriterLeaseStore({ markerDirectory: ".zoom-archive-locks", legacyMarker: ".zoom-archive.lock" })
const tokens = {
  tokens: async () => ({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: 3600000,
    scopes: ["cloud_recording:read:list_user_recordings", "cloud_recording:read:list_recording_files"],
  }),
}
let downloads = 0
const source = new ZoomRecordings(tokens, async (input) => {
  const url = new URL(String(input))
  if (url.origin === "https://api.zoom.us")
    return new Response(
      JSON.stringify({
        id: 123456,
        uuid: "example-shared-writer",
        topic: "Example planning",
        recording_files: [
          {
            id: "example-video",
            file_extension: "MP4",
            recording_type: "shared_screen",
            status: "completed",
            file_size: 6,
            download_url: "https://zoom.us/example-download",
          },
        ],
      }),
    )
  assert.equal(url.origin, "https://zoom.us")
  downloads++
  return new Response("abcdef", { headers: { "content-length": "6", etag: '"example-v1"' } })
})
const held = await leases.acquire(destination)
assert.equal(held.status, "acquired")
try {
  const owners = await inspectArchiveLocks(destination)
  assert.equal(owners.length, 1)
  assert.equal(owners[0].pid, process.pid)
  assert.equal(owners[0].status, "active")
  assert.deepEqual((await recoverArchiveLocks(destination)).removed, [])
  await assert.rejects(source.download("example-shared-writer", { destination, account: "BobSample" }), {
    code: "validation_error",
  })
  assert.equal(downloads, 0)
} finally {
  await held.lease.release()
}
assert.deepEqual(await inspectArchiveLocks(destination), [])
const nonce = "00000000-0000-4000-8000-000000000001"
const staleName = `2147483647-${nonce}.json`
await mkdir(join(destination, ".zoom-archive-locks"))
await writeFile(
  join(destination, ".zoom-archive-locks", staleName),
  JSON.stringify({ version: 1, pid: 2147483647, host: hostname(), nonce }),
)
assert.equal((await inspectArchiveLocks(destination))[0].status, "stale")
assert.deepEqual((await recoverArchiveLocks(destination)).removed, [])
assert.deepEqual((await recoverArchiveLocks(destination, { apply: true })).removed, [staleName])
const report = await source.download("example-shared-writer", { destination, account: "AliceExample" })
assert.equal(report.downloaded.length, 1)
assert.equal(downloads, 1)
assert.equal((await verifyArchive(destination))[0].valid, true)
assert.deepEqual(await inspectArchiveLocks(destination), [])
console.log(
  JSON.stringify({
    shared_core_lease: true,
    cross_account_contention: true,
    provider_layout: true,
    owned_release: true,
    stale_recovery: true,
    verified_archive: true,
  }),
)
