import assert from "node:assert/strict"
import { checkProjectCandidates } from "./installed-project-candidates.mjs"

export const checkPreparationProjects = async ({
  load,
  path,
  now,
  key,
  sample,
  project,
  accountId,
  foreignId,
  read,
  connector,
  requestCount,
}) => {
  const { openStore } = await load("@wirecat/cli-core/store")
  const { prepareMeetingProjectEvidence } = await load("@wirecat/cli-core/meetings")
  const { readMeetingPreparation } = await load("@wirecat/cli-core/cli")
  const store = await openStore({ path, now: () => now })
  let candidateReference, fingerprint
  try {
    for (const name of ["Bureau Example", "ПРИ", "Гавань Пример"])
      await store.knowledge.addVocabularyAlias({ kind: "project", id: project.id }, name)
    const input = {
      ...sample,
      participants: [],
      chat: [],
      meeting: {
        ...sample.meeting,
        title: "ПРИ",
        externalId: "invented-unlinked",
        series: { ...sample.meeting.series, externalId: "789" },
      },
      transcripts: sample.transcripts.map((t) => ({
        ...t,
        rows: t.rows.map((row) => ({ ...row, speakerParticipantPosition: null, text: "HAR Bureau Example ПРИ" })),
      })),
    }
    const candidate = await store.meetings.saveMeeting(input)
    candidateReference = `meeting:${accountId}/${candidate.meeting.id}`
    await store.meetings.saveMeeting({ ...input, meeting: { ...input.meeting, accountId: foreignId } })
    await store.meetings.saveMeeting({
      ...input,
      meeting: { ...input.meeting, externalId: "invented-future", startedAt: now },
    })
    await store.meetings.indexSearch({ accountId })
    fingerprint = (await store.knowledge.vocabulary({ kind: "project" })).fingerprint
  } finally {
    await store.close()
  }
  const before = requestCount()
  const answer = await readMeetingPreparation(read, { series_id: "123", project: "HAR", bytes: 65536 }, undefined, now)
  assert.equal(requestCount(), before + 1)
  const section = answer.item.project_evidence
  assert.ok(section)
  assert.deepEqual(
    section.pages.map((page) => page.term.name),
    ["Harbour Example", "HAR", "Bureau Example", "Гавань Пример"],
  )
  assert.deepEqual(section.pages[0].hits, [])
  for (const page of section.pages.slice(1, 3)) {
    assert.equal(page.association, "unconfirmed-word-evidence")
    assert.equal(page.hits.length, 1)
    assert.equal(page.hits[0].meeting, candidateReference)
    assert.ok(page.hits[0].ref.startsWith(`${candidateReference}/`))
    assert.equal(page.hits[0].source.title, "ПРИ")
    assert.equal(page.hits[0].offset_ms, 0)
  }
  assert.equal(section.pages[1].hits[0].ref, section.pages[2].hits[0].ref)
  assert.equal(section.coverage.has_more, true)
  const next = section.continuation
  assert.ok(next?.cursor)
  const prepared = prepareMeetingProjectEvidence(next.project, {
    query: next.query,
    cursor: next.cursor,
    limit: next.limit,
    maxReadBytes: next.max_read_bytes,
  })
  const connection = await connector({ profile: "AliceExample", externalId: key.account, intent: "read" })
  try {
    const page = await connection.meetingProjectEvidence(next.project, prepared.options)
    assert.equal(page.term.name, "ПРИ")
    assert.equal(page.hasMore, false)
    assert.equal(page.hits.length, 1)
    assert.ok(page.hits[0].ref.startsWith(`${candidateReference}/`))
  } finally {
    await connection.close()
  }
  assert.equal(requestCount(), before + 1)
  const reopened = await openStore({ path })
  try {
    assert.equal((await reopened.knowledge.vocabulary({ kind: "project" })).fingerprint, fingerprint)
    assert.equal((await reopened.knowledge.meetingProjects(key, { projectId: project.id })).items.length, 2)
    assert.equal((await reopened.facts.list()).length, 2)
  } finally {
    await reopened.close()
  }
  const candidateProof = await checkProjectCandidates({
    load,
    path,
    key,
    connector,
    reference: candidateReference,
    project,
  })
  return {
    ...candidateProof,
    cited_project_aliases: true,
    project_alias_continuation: true,
    project_alias_scope_no_writes: true,
  }
}
