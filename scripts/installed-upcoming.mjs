import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { checkInstalledInventory } from "./installed-inventory.mjs"

const root = resolve(process.argv[2])
const require = createRequire(join(root, "node_modules/@wirecat/zoom-cli/package.json"))
const { createZoomUpcomingMeetingReader } = await import(pathToFileURL(require.resolve("@wirecat/zoom-cli")).href)
assert.equal(typeof createZoomUpcomingMeetingReader, "function")
const token = {
  accessToken: "example-access",
  refreshToken: "example-refresh",
  expiresAt: 3600000,
  scopes: ["meeting:read:meeting"],
}
let credentials = 0
let requests = 0
let body = { id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", duration: 30 }
const sdk = createZoomUpcomingMeetingReader(
  "example",
  {
    withSignal: () => ({
      tokens: async () => {
        credentials++
        return token
      },
    }),
  },
  async (url, init) => {
    requests++
    assert.equal(String(url), "https://api.zoom.us/v2/meetings/123")
    assert.equal(init.headers.authorization, "Bearer example-access")
    return new Response(JSON.stringify(body), { headers: { "content-length": "1" } })
  },
)
const window = { after: Date.UTC(2026, 9, 14), until: Date.UTC(2026, 10, 14), signal: new AbortController().signal }
assert.equal(credentials, 0)
await assert.rejects(sdk.next("../123", window), { code: "validation_error" })
assert.equal(credentials, 0)
assert.equal(requests, 0)
const single = await sdk.next("123", window)
assert.deepEqual(single.scope, { provider: "zoom", account: "example" })
assert.equal(single.verifiedNext, true)
assert.equal(single.candidate.startAt, Date.UTC(2026, 9, 15, 10))
body = { id: 123, type: 8, start_time: "2040-01-01T00:00:00Z" }
assert.equal((await sdk.next("123", window)).candidate, null)
body = { ...body, occurrences: [{ occurrence_id: "example", start_time: "2026-10-15T10:00:00Z", status: "available" }] }
const recurring = await sdk.next("123", window)
assert.equal(recurring.candidate.id, "example")
assert.equal(recurring.verifiedNext, false)
assert.equal(recurring.coverage.scheduleComplete, false)
body = { id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", agenda: "x".repeat(10000) }
await assert.rejects(sdk.next("123", { ...window, maxReadBytes: 512 }), { code: "invalid_response" })
const malformed = Buffer.concat([
  Buffer.from('{"id":123,"type":2,"start_time":"2026-10-15T10:00:00Z","agenda":"'),
  Buffer.from([0xff]),
  Buffer.from('"}'),
])
const invalid = createZoomUpcomingMeetingReader(
  "example",
  { withSignal: () => ({ tokens: async () => token }) },
  async () => new Response(malformed),
)
await assert.rejects(invalid.next("123", window), { code: "invalid_response" })
const controller = new AbortController()
let cancelled = false
const cancelledResponse = new Response(
  new ReadableStream({
    cancel: () => {
      cancelled = true
    },
  }),
)
const stopped = createZoomUpcomingMeetingReader(
  "example",
  { withSignal: () => ({ tokens: async () => token }) },
  async () => {
    controller.abort()
    return cancelledResponse
  },
)
await assert.rejects(stopped.next("123", { ...window, signal: controller.signal }), { code: "cancelled" })
assert.equal(cancelled, true)
assert.equal(cancelledResponse.body.locked, false)
const inventory = await checkInstalledInventory({
  load: (name) => import(pathToFileURL(require.resolve(name)).href),
  root,
})
console.log(
  JSON.stringify({
    ...inventory,
    cold_credentials: true,
    fixed_scope: true,
    bounded_wire: true,
    explicit_occurrences: true,
    incomplete_coverage: true,
    strict_utf8: true,
    cancellation_closed: true,
  }),
)
