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
const { readMeetingPreparation, callMeetingPreparationTool } = await load("@wirecat/cli-core/cli")
const { itemEnvelopeSchema } = await load("@wirecat/cli-base/standards")
const { projectFields } = await load("@wirecat/cli-base")
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
const foreign = await store.meetings.saveMeeting({ ...sample, meeting: { ...sample.meeting, accountId: foreignId } })
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
const projectFact = await store.facts.add({
  type: "decision",
  statement: "Use the written launch checklist",
  subject: project.ref,
  by: "owner",
})
const draftNote = await store.notes.addNote({ text: "Bring the checklist", about: [project.ref] })
const projectNote = await store.notes.editNote(draftNote.id, "Bring the written launch checklist", 1)
await store.notes.addNote({ text: "An unrelated personal reminder" })
const relatedInput = {
  ...sample,
  meeting: {
    ...sample.meeting,
    externalId: "invented-related",
    startedAt: now - 2 * 86400000,
    series: { ...sample.meeting.series, externalId: "456" },
  },
}
const related = await store.meetings.saveMeeting(relatedInput)
await store.knowledge.linkMeetingProject(key, String(related.meeting.id), project.id)
await store.meetings.saveMeeting({ ...relatedInput, meeting: { ...relatedInput.meeting, accountId: foreignId } })
const relatedReference = `meeting:${accountId}/${related.meeting.id}`
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
  { series_id: "123", meetings: 1, cues: 1, context_limit: 1, bytes: 16384 },
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
assert.deepEqual(answer.item.related.anchors, [reference])
assert.equal(answer.item.related.items.length, 1)
const extra = answer.item.related.items[0]
assert.equal(extra.ref, relatedReference)
assert.equal(extra.shared_person, true)
assert.equal(extra.shared_project, true)
assert.ok(extra.evidence.items[0].ref.startsWith(`${relatedReference}/`))
assert.equal(answer.item.related.has_more, false)
assert.deepEqual(answer.item.knowledge.anchors, [reference])
assert.equal(answer.item.knowledge.items.length, 1)
assert.equal(answer.item.knowledge.items[0].ref, projectFact.ref)
assert.equal(answer.item.knowledge.items[0].shared_project, true)
assert.equal(answer.item.knowledge.coverage.fact_evidence, "not-revalidated")
assert.equal(answer.item.knowledge.coverage.other_sources, "not-queried")
const selectedFacts = projectFields(answer, ["knowledge.items.ref"])
assert.deepEqual(selectedFacts.item.knowledge.items, [{ ref: projectFact.ref }])
assert.deepEqual(selectedFacts.item.knowledge.coverage, answer.item.knowledge.coverage)
assert.deepEqual(answer.item.notes.anchors, [reference])
assert.equal(answer.item.notes.items.length, 1)
assert.equal(answer.item.notes.items[0].ref, projectNote.ref)
assert.equal(answer.item.notes.items[0].revision, 2)
assert.equal(answer.item.notes.items[0].text, projectNote.text)
assert.equal(answer.item.notes.items[0].project, project.ref)
assert.equal(answer.item.notes.coverage.source_evidence, "not-revalidated")
assert.equal(answer.item.notes.coverage.other_sources, "not-queried")
const selectedNotes = projectFields(answer, ["notes.items.ref"])
assert.deepEqual(selectedNotes.item.notes.items, [{ ref: projectNote.ref }])
assert.deepEqual(selectedNotes.item.notes.coverage, answer.item.notes.coverage)
assert.ok(Buffer.byteLength(JSON.stringify(answer.item)) <= 16384)
const reopened = await openStore({ path })
try {
  assert.equal((await reopened.facts.list()).length, 2)
  assert.equal((await reopened.notes.notes({ source: "internal" })).items.length, 2)
  assert.equal((await reopened.notes.note(projectNote.ref)).revision, 2)
  assert.equal((await reopened.knowledge.meetingProjects(key)).items.length, 2)
} finally {
  await reopened.close()
}
const hiddenNote = "\u200b".repeat(11000)
assert.equal(Buffer.byteLength(hiddenNote), 33000)
const edited = await openStore({ path, now: () => now })
try {
  await edited.notes.editNote(projectNote.id, hiddenNote, 2)
} finally {
  await edited.close()
}
const unframed = await readMeetingPreparation(
  read,
  { series_id: "123", meetings: 1, cues: 1, context_limit: 1, bytes: 65536 },
  undefined,
  now,
)
assert.equal(unframed.item.notes.items.length, 1)
assert.equal(unframed.item.notes.items[0].text, hiddenNote)
assert.ok(Buffer.byteLength(JSON.stringify(unframed.item)) <= 65536)
const framed = await callMeetingPreparationTool(
  read,
  { series_id: "123", meetings: 1, cues: 1, context_limit: 1, bytes: 65536 },
  undefined,
  {},
  now,
)
assert.notEqual(framed.isError, true)
assert.ok(framed.structuredContent.item)
assert.equal(framed.structuredContent.item.meetings.length, 1)
assert.equal(framed.structuredContent.item.notes.items.length, 0)
assert.equal(framed.structuredContent.item.notes.coverage.output_limited, true)
assert.equal(framed.structuredContent.meta.truncated, true)
assert.ok(Buffer.byteLength(JSON.stringify(framed.structuredContent.item)) <= 65536)
assert.deepEqual(JSON.parse(framed.content[0].text), framed.structuredContent)
assert.equal(closed, 3)
const notesStore = await openStore({ path, now: () => now })
let meetingNote
try {
  await notesStore.notes.editNote(projectNote.id, projectNote.text, 3)
  meetingNote = await notesStore.notes.addNote({ text: "Review the meeting checklist", about: [reference] })
  await notesStore.notes.addNote({
    text: "Foreign meeting note",
    about: [`meeting:${foreignId}/${foreign.meeting.id}`, project.ref],
  })
  await notesStore.notes.addNote({ text: "Related meeting note", about: [relatedReference, project.ref] })
} finally {
  await notesStore.close()
}
const directNotes = await callMeetingPreparationTool(
  read,
  { series_id: "123", meetings: 1, cues: 1, context_limit: 10, bytes: 65536 },
  undefined,
  {},
  now,
)
assert.notEqual(directNotes.isError, true)
assert.equal(directNotes.structuredContent.item.notes.selection, "owner-written-meeting/person/project-notes")
const direct = directNotes.structuredContent.item.notes.items
assert.equal(direct.length, 2)
assert.equal(direct[0].ref, meetingNote.ref)
assert.equal(direct[0].meeting, reference)
assert.equal(direct[0].project, null)
assert.equal(direct[1].ref, projectNote.ref)
assert.equal(direct[1].meeting, null)
console.log(
  JSON.stringify({
    cold_credentials: true,
    selected_account: true,
    cited_context: true,
    cited_related_context: true,
    cited_accepted_knowledge: true,
    knowledge_projection: true,
    cited_owner_notes: true,
    cited_meeting_notes: true,
    meeting_note_scope: true,
    notes_projection: true,
    mcp_framed_budget: true,
    bounded_output: true,
    no_writes: true,
    strict_arguments: true,
    close_before_output: true,
  }),
)
