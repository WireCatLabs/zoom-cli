import { strict as assert } from "node:assert"
import { createZoomUpcomingMeetingReader, FilesSource, fileMeeting } from "../src/index.ts"

const meeting = fileMeeting("2026-10-10_1530_example-planning.vtt")
assert.equal(meeting.occurrence.startedAt, "2026-10-10T15:30:00.000Z")
const source = new FilesSource([
  {
    name: "2026-10-10_1530_example-planning.vtt",
    content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Example plan\n",
  },
])
assert.equal((await source.transcript(meeting.occurrence.id))?.[0]?.speaker, "Alice Example")
const upcoming = createZoomUpcomingMeetingReader(
  "example",
  {
    withSignal: () => ({
      tokens: async () => ({
        accessToken: "example-access",
        refreshToken: "example-refresh",
        expiresAt: 3600000,
        scopes: ["meeting:read:meeting"],
      }),
    }),
  },
  async () => new Response(JSON.stringify({ id: 123, type: 2, start_time: "2026-10-15T10:00:00Z" })),
)
const proof = await upcoming.next("123", {
  after: Date.UTC(2026, 9, 14),
  until: Date.UTC(2026, 9, 16),
  signal: new AbortController().signal,
})
assert.equal(proof.verifiedNext, true)
assert.equal(proof.candidate?.startAt, Date.UTC(2026, 9, 15, 10))
console.log("smoke: ok")
