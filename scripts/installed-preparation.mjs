import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(process.argv[2])
const require = createRequire(join(root, "node_modules/@wirecat/zoom-cli/package.json"))
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { createStoreConnector, createZoomPreparationReader, profileAccountKey } = await load("@wirecat/zoom-cli")
const { openStore } = await load("@wirecat/cli-core/store")
const { sampleMeeting } = await load("@wirecat/cli-core/meetings/testing")
const { createTaskFromMeeting } = await load("@wirecat/cli-core/services")
const { readMeetingPreparation } = await load("@wirecat/cli-core/cli")
const { itemEnvelopeSchema } = await load("@wirecat/cli-base/standards")
const v = await load("valibot")
const now = Date.parse("2026-10-14T12:00:00Z")
const path = join(root, "preparation-sdk.db")
const key = { provider: "zoom", account: profileAccountKey("AliceExample") }
const store = await openStore({ path, now: () => now })
const accountId = await store.saveAccount(key, { name: "Alice Example" })
const foreignId = await store.saveAccount({ ...key, account: profileAccountKey("BobSample") }, { name: "Bob Sample" })
const sample = sampleMeeting()
sample.meeting.accountId = accountId
sample.meeting.startedAt = now - 86400000
sample.meeting.endedAt = sample.meeting.startedAt + 1000
sample.meeting.series.externalId = "123"
const saved = await store.meetings.saveMeeting(sample)
await store.meetings.saveMeeting({ ...sample, meeting: { ...sample.meeting, accountId: foreignId } })
const reference = `meeting:${accountId}/${saved.meeting.id}`
const project = await store.knowledge.addProject({ name: "Harbour Example", key: "HAR" })
await store.knowledge.linkMeetingProject(key, String(saved.meeting.id), project.id)
const fact = await store.facts.add({
  type: "decision",
  statement: "Ship the invented draft",
  subject: reference,
  by: "owner",
})
const task = await createTaskFromMeeting(store, key, { source: reference, kind: "promise", origin: "owner" })
await store.close()
let credentials = 0,
  requests = 0,
  closed = 0
const connector = createStoreConnector({ path, now: () => now })
const read = createZoomPreparationReader({
  credentials: () => ({
    withSignal: () => ({
      tokens: async () => {
        credentials++
        return {
          accessToken: "example-access",
          refreshToken: "example-refresh",
          expiresAt: now + 3600000,
          scopes: ["meeting:read:meeting"],
        }
      },
    }),
  }),
  fetch: async (url) => {
    requests++
    assert.equal(String(url), "https://api.zoom.us/v2/meetings/123")
    return new Response(JSON.stringify({ id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", duration: 30 }))
  },
  connect: async () => {
    const connection = await connector({
      profile: "AliceExample",
      externalId: key.account,
      intent: "read",
    })
    return {
      ...connection,
      close: async () => {
        await connection.close()
        closed++
      },
    }
  },
})
assert.equal(credentials, 0)
await assert.rejects(readMeetingPreparation(read, { series_id: "123", account_id: foreignId }, undefined, now), {
  code: "validation_error",
})
assert.equal(requests, 0)
assert.equal(credentials, 0)
const answer = await readMeetingPreparation(
  read,
  { series_id: "123", meetings: 1, cues: 1, context_limit: 1, bytes: 8192 },
  undefined,
  now,
)
v.parse(itemEnvelopeSchema(v.unknown()), answer)
assert.equal(closed, 1)
assert.equal(credentials, 1)
assert.equal(requests, 1)
assert.equal(answer.item.account_id, String(accountId))
assert.equal(answer.item.upcoming.verified_next, true)
assert.equal(answer.item.meetings.length, 1)
const meeting = answer.item.meetings[0]
assert.equal(meeting.ref, reference)
assert.equal(meeting.evidence.items[0].text, "Ship the example plan.")
assert.ok(meeting.evidence.items[0].ref.startsWith(`${reference}/`))
assert.equal(meeting.context.projects.items[0].ref, project.ref)
assert.equal(meeting.context.facts.items[0].ref, fact.ref)
assert.equal(meeting.context.tasks.items[0].ref, `task:${task.task.id}`)
assert.ok(Buffer.byteLength(JSON.stringify(answer.item)) <= 8192)
const reopened = await openStore({ path })
try {
  assert.equal((await reopened.facts.list()).length, 1)
  assert.equal((await reopened.knowledge.meetingProjects(key)).items.length, 1)
} finally {
  await reopened.close()
}
console.log(
  JSON.stringify({
    cold_credentials: true,
    selected_account: true,
    cited_context: true,
    bounded_output: true,
    no_writes: true,
    strict_arguments: true,
    close_before_output: true,
  }),
)
