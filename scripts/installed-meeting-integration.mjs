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
      const accountId = (await store.accounts.storedAccount(key)).id
      const foreignAccountId = (await store.accounts.storedAccount(foreignKey)).id
      const meeting = sampleMeeting()
      meeting.meeting.accountId = accountId
      meeting.meeting.externalId = "AliceExample-installed-integration"
      meeting.chat = []
      meeting.summaries = []
      meeting.attachments = []
      meeting.participants[0].identity.associatePerson = false
      meeting.participants[0].identity.externalId = "AliceExample-installed-guest"
      meeting.participants.push({
        ...meeting.participants[0],
        displayName: "Alice Example Second",
        identity: { ...meeting.participants[0].identity, externalId: "AliceExample-installed-second-guest" },
      })
      meeting.meeting.participantsCount = 2
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
      await store.knowledge.addVocabularyAlias({ kind: "project", id: project.id }, "needle")
      await store.knowledge.linkMeetingProject(key, String(saved.meeting.id), project.id)
      await store.knowledge.addTags(key, { type: "meeting", id: String(saved.meeting.id) }, ["planning"])
      const topic = await store.knowledge.createTag("budget", { kind: "topic" })
      await store.knowledge.addVocabularyAlias({ kind: "topic", id: String(topic.id) }, "costs")
      await store.knowledge.setMainTopic(key, { type: "meeting", id: String(saved.meeting.id) }, "budget")
      await store.people.savePeople(foreignKey, [{ id: "BobSample-installed-target", name: "Bob Sample" }])
      const target = await store.people.personOf({ provider: "zoom", id: "BobSample-installed-target" })
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
    const present = await store.people.personSeenInAccounts(personUid, [accountId])
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
  assert.equal(unlinked.result.previous_event_id, String(target.eventId))
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
  const linked = json(...personArgs, "--source", String(target.foreignAccountId), "--yes")
  assert.equal(linked.applied, true)
  assert.equal(linked.result.changed, true)
  const after = native("audit", target)
  assert.equal(after.person.personUid, target.personUid)
  assert.equal(after.present, true)
  assert.equal(after.involvement, true)
  assert.deepEqual(after.audit, [
    { method: "manual", author: "owner", from_person_id: null, to_person_id: Number(target.personUid) },
  ])
  invoke(["--json", ...personArgs, "--source", String(target.foreignAccountId), "--yes"], 3)
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
    assert.equal(page.missing, undefined)
    assert.ok(page.next?.[0]?.args.query === query || !page.page.has_more)
    assert.ok(
      page.items.every(
        (hit) => hit.meeting === `meeting:${target.accountId}/${target.meetingId}` && hit.ref.startsWith("meeting:"),
      ),
    )
    hits.push(...page.items)
    cursor = page.page.next_cursor
    firstCursor ??= cursor
  } while (cursor)
  assert.equal(hits.length, 9)
  const cueRef = hits[0].ref
  const batchInput = JSON.stringify({
    requests: [
      { id: "q1", command: ["search", "meetings"], args: ["needle", "--limit", "1"] },
      { id: "p1", command: ["meetings", "passage"], args: [cueRef, "--before-n", "0", "--after-n", "1"] },
      { id: "stale", command: ["meetings", "passage"], args: [cueRef, "--expected-fingerprint", "f".repeat(64)] },
      { id: "q2", command: ["search", "meetings"], args: ["needle", "--limit", "2"] },
    ],
  })
  const batchFile = join(sandbox, "meeting-batch.json")
  writeFileSync(batchFile, batchInput)
  const batch = JSON.parse(invoke(["batch", batchFile, "--json"]).stdout)
  assert.deepEqual(
    batch.items.map((item) => item.id),
    ["q1", "p1", "stale", "q2"],
  )
  assert.deepEqual(
    batch.items.map((item) => item.status),
    ["ok", "ok", "error", "ok"],
  )
  assert.equal(batch.meta.complete, false)
  assert.equal(batch.items[0].answer.items.length, 1)
  assert.equal(batch.items[3].answer.items.length, 2)
  assert.ok(batch.items[0].answer.page.next_cursor)
  assert.equal(batch.items[1].answer.item.target_ref, cueRef)
  const batchLines = invoke(["batch", "-", "--jsonl"], 0, {}, batchInput)
    .stdout.trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    batchLines.map((line) => line.type),
    ["item", "item", "item", "item", "end"],
  )
  assert.equal(batchLines.at(-1).complete, false)
  assert.deepEqual(
    batchLines.slice(0, -1).map((line) => line.data.status),
    ["ok", "ok", "error", "ok"],
  )
  const resumeBatch = JSON.stringify({
    requests: [
      {
        id: "q1-next",
        command: ["search", "meetings"],
        args: ["needle", "--limit", "1", "--cursor", batch.items[0].answer.page.next_cursor],
      },
      {
        id: "q2-next",
        command: ["search", "meetings"],
        args: ["needle", "--limit", "2", "--cursor", batch.items[3].answer.page.next_cursor],
      },
    ],
  })
  const resumed = JSON.parse(invoke(["batch", "-", "--json"], 0, {}, resumeBatch).stdout)
  assert.equal(resumed.meta.complete, true)
  assert.notEqual(resumed.items[0].answer.items[0].ref, batch.items[0].answer.items[0].ref)
  assert.notEqual(resumed.items[1].answer.items[0].ref, batch.items[3].answer.items[0].ref)
  const refused = JSON.parse(invoke(["batch", batchFile, "--max-read-bytes", "1", "--json"]).stdout)
  assert.deepEqual(
    refused.items.map((item) => item.status),
    ["not_run", "not_run", "not_run", "not_run"],
  )
  assert.equal(refused.meta.complete, false)
  const topicHits = json("search", "meetings", "needle", "--topic", "costs", "--project", "RES")
  assert.equal(topicHits.items.length, 9)
  assert.deepEqual(topicHits.items, json("search", "meetings", "needle", "--topic", "budget", "--project", "RES").items)
  invoke(["--json", "search", "meetings", "needle", "--topic", "missing-invented-topic", "--project", "RES"], 6)
  const projectPacket = (...args) => JSON.parse(invoke(["--json", ...args]).stdout)
  const projectHits = []
  let projectCursor
  let projectPages = 0
  do {
    const answer = projectPacket(
      "meetings",
      "projects",
      "evidence",
      "RES",
      `meeting_id:${target.meetingId} identity_id:${target.identityId}`,
      "--limit",
      "2",
      "--max-read-bytes",
      "4096",
      ...(projectCursor ? ["--cursor", projectCursor] : []),
    )
    assert.equal(answer.item.project.key, "RES")
    assert.equal(answer.item.association, "unconfirmed-word-evidence")
    assert.equal(answer.item.coverage.archive_completeness, "unknown")
    assert.equal(answer.item.limits.max_read_bytes, 4096)
    assert.equal(typeof answer.meta.run_id, "string")
    assert.equal(Number.isInteger(answer.meta.duration_ms), true)
    projectHits.push(...answer.item.hits)
    projectCursor = answer.item.page.next_cursor
    if (projectCursor) assert.equal(answer.next[0].args.project, "RES")
    if (++projectPages > 16) throw Error("unbounded installed project evidence")
  } while (projectCursor)
  assert.equal(projectHits.length, 9)
  assert.ok(projectHits.every((hit) => hit.meeting === reference && hit.ref.startsWith(`${reference}/`)))
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
  environment.ZM_PROFILE = "invented-foreign-platform"
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
  environment.ZM_PROFILE = "invented-platform"
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
    meetingBatch: { fileAndStdin: true, jsonAndJsonl: true, independentCursors: true, partialAndBudgetRefusals: true },
    projectEvidence: { hits: projectHits.length, pages: projectPages, cited: true },
    crossAccountCursorRejected: true,
    transcriptionPreviewAndMissingModel: true,
    duplicateMemoCommands: false,
  }
}

if (process.argv[2] === "--fixture") {
  console.log(JSON.stringify(await fixture(process.argv[3], process.argv[4], JSON.parse(process.argv[5]))))
}
