import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"

const [installedRoot, destination, phase] = process.argv.slice(2)
assert.ok(installedRoot && isAbsolute(installedRoot))
assert.ok(destination && isAbsolute(destination))
assert.ok(["full", "fail", "resume"].includes(phase))
const require = createRequire(join(installedRoot, "node_modules", "@wirecat", "zoom-cli", "package.json"))
const { ZoomRecordings, verifyArchive } = await import(pathToFileURL(require.resolve("@wirecat/zoom-cli")).href)
const account = "AliceExample"
const uuid = "example-installed-occurrence"
const fileId = "example-installed-video"
const validator = '"example-installed-v1"'
const hash = (value) => createHash("sha256").update(value).digest("hex")
const tokens = {
  tokens: async () => ({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: 3600000,
    scopes: ["cloud_recording:read:list_user_recordings", "cloud_recording:read:list_recording_files"],
  }),
}
const metadata = {
  id: 123456,
  uuid,
  topic: "Alice Example planning",
  recording_files: [
    {
      id: fileId,
      file_extension: "MP4",
      recording_type: "shared_screen",
      status: "completed",
      file_size: 6,
      download_url: "https://zoom.us/example-download?signature=example-private",
    },
  ],
}
let downloads = 0
const source = new ZoomRecordings(
  tokens,
  async (input, init) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    assert.equal(init.redirect, "manual")
    assert.equal(headers.get("authorization"), "Bearer example-access")
    if (url.origin === "https://api.zoom.us") {
      assert.ok(url.pathname.startsWith("/v2/meetings/") && url.pathname.endsWith("/recordings"))
      return new Response(JSON.stringify(metadata))
    }
    assert.equal(url.origin, "https://zoom.us")
    assert.equal(url.pathname, "/example-download")
    downloads++
    assert.equal(headers.get("accept-encoding"), "identity")
    if (phase === "full") {
      assert.equal(headers.get("range"), null)
      assert.equal(headers.get("if-range"), null)
      return new Response("abcdef", { headers: { etag: validator, "content-length": "6" } })
    }
    if (phase === "fail" && downloads === 1) {
      assert.equal(headers.get("range"), null)
      let first = true
      const body = new ReadableStream({
        pull(controller) {
          if (first) {
            first = false
            controller.enqueue(new TextEncoder().encode("abc"))
          } else controller.error(new Error("invented stream interruption"))
        },
      })
      return new Response(body, { headers: { etag: validator, "content-length": "6" } })
    }
    assert.equal(headers.get("range"), "bytes=3-")
    assert.equal(headers.get("if-range"), validator)
    const body =
      phase === "fail"
        ? new ReadableStream({
            start(controller) {
              controller.error(new Error("invented repeated interruption"))
            },
          })
        : "def"
    return new Response(body, {
      status: 206,
      headers: {
        etag: validator,
        "content-length": "3",
        "content-range": "bytes 3-5/6",
      },
    })
  },
  { sleep: async () => {} },
)
const options = { destination, account, resume: true, maxBytes: 64 }
if (phase === "fail") {
  await assert.rejects(source.download(uuid, options), { code: "network_error" })
  assert.equal(downloads, 3)
  const names = await readdir(destination)
  const partial = names.find((name) => /^\.zoom-partial-[a-f0-9]{64}\.json$/.test(name))
  assert.ok(partial)
  const checkpoint = JSON.parse(await readFile(join(destination, partial), "utf8"))
  assert.equal(checkpoint.offset, 3)
  assert.equal(checkpoint.total, 6)
  assert.equal(checkpoint.validator, validator)
  assert.equal(checkpoint.sha256, hash("abc"))
  assert.deepEqual(checkpoint.locator, { provider: "zoom", account, occurrenceId: uuid, assetId: fileId })
  assert.equal(await readFile(join(destination, partial.replace(/\.json$/, ".part")), "utf8"), "abc")
  assert.equal(JSON.stringify(checkpoint).includes("signature"), false)
  assert.equal(
    names.some((name) => /^\.zoom-archive-[a-f0-9]{64}\.json$/.test(name)),
    false,
  )
} else {
  const report = await source.download(uuid, options)
  assert.equal(downloads, 1)
  assert.equal(report.downloaded.length, 1)
  const file = report.downloaded[0]
  assert.equal(file.size, 6)
  assert.equal(file.sha256, hash("abcdef"))
  assert.equal(await readFile(join(destination, file.path), "utf8"), "abcdef")
  assert.equal((await verifyArchive(destination))[0].valid, true)
  assert.equal((await source.download(uuid, options)).skipped.length, 1)
  assert.equal(downloads, 1)
}
console.log(
  JSON.stringify({
    phase,
    downloads,
    prefixRetained: phase === "fail",
    resumed: phase === "resume",
    verified: phase !== "fail",
  }),
)
