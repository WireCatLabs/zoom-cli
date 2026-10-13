import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const self = fileURLToPath(import.meta.url)
const loadStore = async (root) => {
  const require = createRequire(join(root, "node_modules", "@wirecat", "zoom-cli", "package.json"))
  const { openStore } = await import(pathToFileURL(require.resolve("@wirecat/cli-core/store")).href)
  return openStore({ path: process.env.MESSAGING_STORE, env: process.env, now: () => 3000 })
}

const fixture = async (root, phase, input) => {
  const store = await loadStore(root)
  try {
    if (phase === "seed") {
      const require = createRequire(join(root, "node_modules", "@wirecat", "zoom-cli", "package.json"))
      const { sampleMeeting, sampleEvent } = await import(
        pathToFileURL(require.resolve("@wirecat/cli-core/meetings/testing")).href
      )
      const key = { provider: "zoom", account: "zm-profile:invented-platform" }
      const foreignKey = { provider: "zoom", account: "zm-profile:invented-foreign-platform" }
      const accountId = (await store.storedAccount(key)).id
      const foreignAccountId = (await store.storedAccount(foreignKey)).id
      const meeting = sampleMeeting()
      meeting.meeting.accountId = accountId
      meeting.meeting.externalId = "AliceExample-installed-integration"
      meeting.chat = []
      meeting.summaries = []
      meeting.attachments = []
      meeting.participants[0].identity.associatePerson = false
      meeting.participants[0].identity.externalId = "AliceExample-installed-guest"
      meeting.transcripts[0].contentHash = "AliceExample-installed-stemming"
      meeting.transcripts[0].rows = Array.from({ length: 9 }, (_, position) => ({
        ...meeting.transcripts[0].rows[0],
        position,
        startMs: position * 1000,
        endMs: (position + 1) * 1000,
        text: `Alice Example runs organiza обсуждает needle ${position}`,
      }))
      const saved = await store.meetings.saveMeeting(meeting)
      const project = await store.knowledge.addProject({ name: "Research Example", key: "RES", scope: "work" })
      await store.knowledge.addVocabularyAlias({ kind: "project", id: project.id }, "research-alias")
      await store.knowledge.linkMeetingProject(key, String(saved.meeting.id), project.id)
      await store.knowledge.addTags(key, { type: "meeting", id: String(saved.meeting.id) }, ["planning"])
      const topic = await store.knowledge.createTag("budget", { kind: "topic" })
      await store.knowledge.addVocabularyAlias({ kind: "topic", id: String(topic.id) }, "costs")
      await store.knowledge.setMainTopic(key, { type: "meeting", id: String(saved.meeting.id) }, "budget")
      await store.savePeople(foreignKey, [{ id: "BobSample-installed-target", name: "Bob Sample" }])
      const target = await store.personOf({ provider: "zoom", id: "BobSample-installed-target" })
      assert.ok(target)
      const event = await store.meetings.createEvent({ ...sampleEvent(), origin: "owner" }, 3000)
      return {
        accountId,
        foreignAccountId,
        meetingId: saved.meeting.id,
        participantId: saved.participants[0].id,
        identityId: saved.participants[0].identityId,
        personUid: target.uid,
        eventId: event.id,
      }
    }
    const { accountId, meetingId, participantId, personUid, identityId } = input
    const person = await store.meetings.participantPerson({ accountId, meetingId, participantId })
    const meeting = await store.meetings.meetingMetadata({ accountId, meetingId })
    const revisions = await store.meetings.transcripts({ accountId, meetingId, includeHistorical: true, limit: 10 })
    const present = await store.personSeenInAccounts(personUid, [accountId])
    const involvement = store.involvements
      .forPerson(Number(personUid))
      .some((item) => item.subjectType === "meeting" && item.subjectId === meetingId)
    let database
    try {
      // Only this fresh invented fixture is inspected; the public store has no audit reader.
      if (process.versions.bun) {
        const { Database } = await import("bun:sqlite")
        database = new Database(process.env.MESSAGING_STORE, { readonly: true })
      } else {
        const { DatabaseSync } = await import("node:sqlite")
        database = new DatabaseSync(process.env.MESSAGING_STORE, { readOnly: true })
      }
      const query = "SELECT method,author,from_person_id,to_person_id FROM identity_link_events WHERE identity_id=?"
      const audit = (database.prepare ?? database.query)
        .call(database, query)
        .all(Number(identityId))
        .map((row) => ({ ...row }))
      return {
        person,
        eventId: meeting.eventId,
        revisions: { ids: revisions.items.map((item) => item.id), hasMore: revisions.hasMore },
        present,
        involvement,
        audit,
      }
    } finally {
      database?.close()
    }
  } finally {
    await store.close()
  }
}

export const installedMeetingIntegration = async ({
  root,
  sandbox,
  environment,
  prefix,
  json,
  invoke,
  diagnostics,
}) => {
  const native = (phase, value) => {
    const result = spawnSync(
      process.execPath,
      [...prefix, self, "--fixture", root, phase, JSON.stringify(value ?? {})],
      {
        cwd: root,
        env: environment,
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, `${phase} installed native fixture: ${result.stderr}`)
    assert.equal(diagnostics(result.stderr), "")
    assert.equal(existsSync(environment.ZM_PLATFORM_DENIED), false)
    return JSON.parse(result.stdout)
  }
  const target = native("seed")
  const reference = `meeting:${target.accountId}/${target.meetingId}`
  const before = native("audit", target)
  assert.equal(before.person.personUid, null)
  assert.equal(before.present, false)
  assert.equal(before.involvement, false)
  assert.deepEqual(before.audit, [])
  const eventArgs = [
    "meetings",
    "update",
    reference,
    "--event-id",
    String(target.eventId),
    "--expected-event-id",
    "none",
  ]
  assert.equal(json(...eventArgs).applied, false)
  assert.equal(json(...eventArgs, "--yes", "--dry-run").applied, false)
  assert.equal(native("audit", target).eventId, null)
  const event = json(...eventArgs, "--yes")
  assert.equal(event.applied, true)
  assert.equal(event.result.changed, true)
  assert.equal(native("audit", target).eventId, target.eventId)
  invoke(["--json", ...eventArgs, "--yes"], 3)
  const unlinked = json(
    "meetings",
    "update",
    reference,
    "--event-id",
    "none",
    "--expected-event-id",
    String(target.eventId),
    "--yes",
  )
  assert.equal(unlinked.result.previous_event_id, target.eventId)
  assert.equal(native("audit", target).eventId, null)
  assert.equal(json(...eventArgs, "--yes").result.changed, true)
  const personArgs = [
    "meetings",
    "link",
    reference,
    "--participant-id",
    String(target.participantId),
    "--person",
    target.personUid,
    "--expected-person",
    "none",
  ]
  assert.equal(json(...personArgs).applied, false)
  invoke(["--json", ...personArgs, "--yes"], 6)
  assert.deepEqual(native("audit", target).audit, [])
  const linked = json(...personArgs, "--target-accounts", String(target.foreignAccountId), "--yes")
  assert.equal(linked.applied, true)
  assert.equal(linked.result.changed, true)
  const after = native("audit", target)
  assert.equal(after.person.personUid, target.personUid)
  assert.equal(after.present, true)
  assert.equal(after.involvement, true)
  assert.deepEqual(after.audit, [
    { method: "manual", author: "owner", from_person_id: null, to_person_id: Number(target.personUid) },
  ])
  invoke(["--json", ...personArgs, "--target-accounts", String(target.foreignAccountId), "--yes"], 3)
  assert.deepEqual(native("audit", target).audit, after.audit)
  const unchanged = json(
    "meetings",
    "link",
    reference,
    "--participant-id",
    String(target.participantId),
    "--person",
    target.personUid,
    "--expected-person",
    target.personUid,
    "--yes",
  )
  assert.equal(unchanged.result.changed, false)
  assert.deepEqual(native("audit", target).audit, after.audit)
  const query = "running organizar обсуждать needle"
  const hits = []
  const contextFilters = [
    "--identity-id",
    String(target.identityId),
    "--person-id",
    target.personUid,
    "--project",
    "research-alias",
    "--tag",
    "planning",
    "--since-time",
    "1970-01-01T00:00:01Z",
    "--until-time",
    "1970-01-01T00:00:01Z",
  ]
  let cursor
  let firstCursor
  do {
    const page = json(
      "search",
      "meetings",
      query,
      "--meeting-id",
      String(target.meetingId),
      "--limit",
      "2",
      ...contextFilters,
      ...(cursor ? ["--cursor", cursor] : []),
    )
    assert.deepEqual(page.coverage, {
      archive_completeness: "unknown",
      current_revisions: true,
      indexing: "ready",
      index_completeness: "unknown",
    })
    assert.ok(page.items.every((hit) => hit.meeting_id === target.meetingId))
    hits.push(...page.items)
    cursor = page.next_cursor
    firstCursor ??= cursor
  } while (cursor)
  assert.equal(hits.length, 9)
  const topicHits = json("search", "meetings", "needle", "--topic", "costs", "--project", "RES")
  assert.equal(topicHits.items.length, 9)
  assert.equal(topicHits.selection[1].name, "budget")
  assert.equal(new Set(hits.map((hit) => hit.id)).size, 9)
  assert.ok(firstCursor)
  invoke(
    [
      "--json",
      "search",
      "meetings",
      "other query",
      "--meeting-id",
      String(target.meetingId),
      "--limit",
      "2",
      ...contextFilters,
      "--cursor",
      firstCursor,
    ],
    2,
  )
  json("config", "set", "account.profile", "invented-foreign-platform")
  invoke(
    [
      "--json",
      "search",
      "meetings",
      query,
      "--meeting-id",
      String(target.meetingId),
      "--limit",
      "2",
      ...contextFilters,
      "--cursor",
      firstCursor,
    ],
    2,
  )
  invoke(["--json", "meetings", "update", reference, "--event-id", "none", "--yes"], 6)
  json("config", "set", "account.profile", "invented-platform")
  const audio = join(sandbox, "AliceExample-transcription.wav")
  const dataSize = 32000
  const wav = Buffer.alloc(44 + dataSize)
  wav.write("RIFF", 0)
  wav.writeUInt32LE(36 + dataSize, 4)
  wav.write("WAVEfmt ", 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write("data", 36)
  wav.writeUInt32LE(dataSize, 40)
  writeFileSync(audio, wav)
  const models = join(sandbox, "empty-speech-models")
  mkdirSync(models)
  const transcribe = ["meetings", "transcribe", reference, audio, "--model", "parakeet-v3", "--models-dir", models]
  const preview = json(...transcribe)
  assert.equal(preview.applied, false)
  assert.equal(preview.media.duration_ms, 1000)
  assert.equal(json(...transcribe, "--yes", "--dry-run").applied, false)
  const missingModel = invoke(["--json", ...transcribe, "--yes"], 6)
  assert.match(missingModel.stderr, /not installed/)
  assert.equal(readFileSync(audio).equals(wav), true)
  assert.deepEqual(native("audit", target), after)
  const commands = json("commands", "meetings").commands[0].commands.map((command) => command.path.join(" "))
  assert.equal(
    commands.some((command) => /^meetings (notes|tags|memories)(?: |$)/.test(command)),
    false,
  )
  assert.ok(commands.includes("meetings update"))
  const searches = json("commands", "search").commands[0].commands.map((command) => command.path.join(" "))
  assert.ok(searches.includes("search meetings"))
  return {
    scopedLinks: true,
    compareAndSave: true,
    guestManualAudit: true,
    immediateAccountPresenceAndInvolvement: true,
    readonlySearchPreview: true,
    configuredStemming: ["English", "Russian", "Spanish"],
    hitContinuation: hits.length,
    crossAccountCursorRejected: true,
    transcriptionPreviewAndMissingModel: true,
    duplicateMemoCommands: false,
  }
}

if (process.argv[2] === "--fixture") {
  console.log(JSON.stringify(await fixture(process.argv[3], process.argv[4], JSON.parse(process.argv[5]))))
}
