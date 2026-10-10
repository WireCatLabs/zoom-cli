import { strict as assert } from "node:assert"
import { FilesSource, fileMeeting } from "../src/index.ts"

const meeting = fileMeeting("2026-10-10_1530_example-planning.vtt")
assert.equal(meeting.occurrence.startedAt, "2026-10-10T15:30:00.000Z")
const source = new FilesSource([
  {
    name: "2026-10-10_1530_example-planning.vtt",
    content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Example plan\n",
  },
])
assert.equal((await source.transcript(meeting.occurrence.id))?.[0]?.speaker, "Alice Example")
console.log("smoke: ok")
