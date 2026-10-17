import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { createTaskFromMeeting } from "@wirecat/cli-core/services"
import { openStore } from "@wirecat/cli-core/store"
import { expect, vi } from "vitest"
import { profileAccountKey, setConfig } from "../../src/config.js"
import type { ProgramDeps } from "../../src/program.js"
import { createStoreConnector } from "../../src/store-connection.js"
import { TokenManager } from "../../src/tokens.js"

export const now = Date.parse("2026-10-14T12:00:00Z")
export const preparationFixture = async (
  noteText = "Bring the written launch checklist",
  meetingNotes = false,
  projectEvidence = false,
) => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-preparation-"))
  const path = join(directory, "fixture.db")
  const env = { MESSAGING_STORE: path }
  const store = await openStore({ path, env, now: () => now })
  const key = { provider: "zoom", account: profileAccountKey("AliceExample") }
  const accountId = await store.accounts.saveAccount(key, { name: "Alice Example" })
  const otherId = await store.accounts.saveAccount(
    { ...key, account: profileAccountKey("BobSample") },
    { name: "Bob Sample" },
  )
  const sample = sampleMeeting()
  const series = sample.meeting.series
  if (!series) throw new Error("Missing invented series")
  const input = {
    ...sample,
    meeting: {
      ...sample.meeting,
      accountId,
      startedAt: now - 86400000,
      endedAt: now - 86400000 + 1000,
      series: { ...series, externalId: "123" },
    },
  }
  const saved = await store.meetings.saveMeeting(input)
  const foreign = await store.meetings.saveMeeting({ ...input, meeting: { ...input.meeting, accountId: otherId } })
  const reference = `meeting:${accountId}/${saved.meeting.id}`
  const project = await store.knowledge.addProject({ name: "Harbour Example", key: "HAR" })
  await store.knowledge.linkMeetingProject(key, String(saved.meeting.id), project.id)
  await store.facts.add({ type: "decision", statement: "Ship the invented draft", subject: reference, by: "owner" })
  const projectFact = await store.facts.add({
    type: "decision",
    statement: "Use the written launch checklist",
    subject: project.ref,
    by: "owner",
  })
  await store.facts.add({
    type: "statement",
    statement: "An unreviewed project suggestion",
    subject: project.ref,
    by: { bot: "invented-reviewer" },
  })
  const draftNote = await store.notes.addNote({ text: "Bring the checklist", about: [project.ref] })
  const projectNote = await store.notes.editNote(draftNote.id, noteText, 1)
  await store.notes.addNote({ text: "An unrelated personal reminder" })
  await createTaskFromMeeting(store, key, { source: reference, kind: "promise", origin: "owner" })
  const relatedInput = {
    ...input,
    meeting: {
      ...input.meeting,
      externalId: "invented-related",
      startedAt: now - 2 * 86400000,
      series: { ...series, externalId: "456" },
    },
  }
  const related = await store.meetings.saveMeeting(relatedInput)
  await store.knowledge.linkMeetingProject(key, String(related.meeting.id), project.id)
  await store.meetings.saveMeeting({ ...relatedInput, meeting: { ...relatedInput.meeting, accountId: otherId } })
  const relatedReference = `meeting:${accountId}/${related.meeting.id}`
  const meetingNote = meetingNotes
    ? await store.notes.addNote({ text: "Review the meeting-specific checklist", about: [reference] })
    : undefined
  if (meetingNotes) {
    await store.notes.addNote({
      text: "Foreign meeting note",
      about: [`meeting:${otherId}/${foreign.meeting.id}`, project.ref],
    })
    await store.notes.addNote({ text: "Related meeting note", about: [relatedReference, project.ref] })
  }
  let candidateReference: string | undefined
  if (projectEvidence) {
    await store.knowledge.addVocabularyAlias({ kind: "project", id: project.id }, "Bureau Example")
    await store.knowledge.addVocabularyAlias({ kind: "project", id: project.id }, "ПРИ")
    const candidateInput = {
      ...input,
      participants: [],
      chat: [],
      meeting: {
        ...input.meeting,
        externalId: "invented-unlinked",
        title: "ПРИ",
        series: { ...series, externalId: "789" },
      },
      transcripts: input.transcripts.map((t) => ({
        ...t,
        rows: t.rows.map((row) => ({ ...row, speakerParticipantPosition: null, text: "HAR Bureau Example ПРИ" })),
      })),
    }
    const candidate = await store.meetings.saveMeeting(candidateInput)
    candidateReference = `meeting:${accountId}/${candidate.meeting.id}`
    await store.meetings.saveMeeting({ ...candidateInput, meeting: { ...candidateInput.meeting, accountId: otherId } })
    await store.meetings.saveMeeting({
      ...candidateInput,
      meeting: { ...candidateInput.meeting, externalId: "invented-future", startedAt: now },
    })
    await store.meetings.indexSearch({ accountId })
  }
  await store.close()
  const network = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", duration: 30 })),
  )
  const tokens = new TokenManager({
    clientId: "invented-client",
    keyring: memoryKeyring(),
    service: "invented",
    fetch: network,
    now: () => now,
  })
  tokens.save({
    accessToken: "invented-access",
    refreshToken: "invented-refresh",
    expiresAt: now + 3600000,
    scopes: ["meeting:read:meeting"],
  })
  const connector = createStoreConnector({ path, env, now: () => now })
  const closed = vi.fn()
  const connectStore = vi.fn<NonNullable<ProgramDeps["connectStore"]>>(async (request) => {
    const connection = await connector(request)
    return {
      ...connection,
      close: async () => {
        await connection.close()
        closed()
      },
    }
  })
  const output: string[] = [],
    errors: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens,
    fetch: network,
    now: () => now,
    connectStore,
    openBrowser: vi.fn(),
    data: (text) => {
      expect(closed).toHaveBeenCalledTimes(connectStore.mock.calls.length)
      output.push(text)
    },
    diagnostic: (text) => errors.push(text),
  }
  setConfig(deps.configPath, "account.profile", "AliceExample")
  setConfig(deps.configPath, "zoom.clientId", "invented-client")
  return {
    path,
    key,
    project,
    candidateReference,
    deps,
    output,
    errors,
    network,
    tokens,
    connectStore,
    closed,
    accountId,
    reference,
    projectFact,
    projectNote,
    meetingNote,
    relatedReference,
    mcp: {
      now: () => now,
      connectStore: () => connectStore({ profile: "AliceExample", externalId: key.account, intent: "read" }),
      preparation: { credentials: () => tokens, fetch: network },
    },
  }
}
