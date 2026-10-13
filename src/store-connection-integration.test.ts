import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { memoryMeetingStore, sampleEvent, sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { openStore } from "@wirecat/cli-core/store"
import { expect, it } from "vitest"
import { setConfig } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const fixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-connection-context-"))
  const path = join(directory, "fixture.db")
  const env = {
    MESSAGING_STORE: path,
    HOME: directory,
    USERPROFILE: directory,
    APPDATA: join(directory, "appdata"),
    LOCALAPPDATA: join(directory, "localappdata"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
    XDG_CACHE_HOME: join(directory, "cache"),
    TEMP: directory,
    TMP: directory,
  }
  const store = await openStore({ path, env, now: () => 3000 })
  try {
    const key = { provider: "zoom", account: "zm-profile:AliceExample" }
    const accountId = await store.saveAccount(key, { name: "Alice Example" })
    const foreignId = await store.saveAccount(
      { provider: "zoom", account: "zm-profile:BobSample" },
      { name: "Bob Sample" },
    )
    const input = sampleMeeting()
    input.meeting.accountId = accountId
    input.participants[0].identity.associatePerson = false
    const meeting = await store.meetings.saveMeeting(input)
    await store.savePeople({ provider: "zoom", account: "zm-profile:BobSample" }, [
      { id: "BobSample", name: "Bob Sample" },
    ])
    const target = await store.personOf({ provider: "zoom", id: "BobSample" })
    if (!target) throw new Error("missing invented person")
    const event = await store.meetings.createEvent({ ...sampleEvent(), origin: "owner" }, 3000)
    return { path, env, directory, accountId, foreignId, meeting, target, event }
  } finally {
    await store.close()
  }
}
const request = {
  profile: "AliceExample",
  externalId: "zm-profile:AliceExample",
  intent: "read" as const,
}

const audioFixture = (directory: string) => {
  const audio = join(directory, "AliceExample.wav")
  const models = join(directory, "empty-models")
  mkdirSync(models)
  const wav = Buffer.alloc(44 + 32000)
  wav.write("RIFF", 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write("WAVEfmt ", 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write("data", 36)
  wav.writeUInt32LE(32000, 40)
  writeFileSync(audio, wav)
  return { audio, models }
}

it("connects actual published context services to an existing scoped account without duplicating records", async () => {
  const value = await fixture()
  const connection = await createStoreConnector({ path: value.path, env: value.env })({
    ...request,
    capability: "meeting-integration",
  })
  try {
    const integration = connection.meetingIntegration
    if (!integration) throw new Error("missing published meeting link capability")
    const reference = `meeting:${value.accountId}/${value.meeting.meeting.id}`
    const change = { action: "event.link" as const, eventId: value.event.id, expectedEventId: null }
    expect(await integration.change(reference, change)).toMatchObject({ applied: false, accountId: value.accountId })
    expect(await integration.change(reference, change, { apply: true, dryRun: true })).toMatchObject({ applied: false })
    expect(await integration.change(reference, change, { apply: true })).toMatchObject({
      applied: true,
      result: { eventId: value.event.id, previousEventId: null, changed: true },
    })
    await expect(integration.change(reference, change, { apply: true })).rejects.toMatchObject({
      code: "configuration_error",
    })
    await expect(
      integration.change(`meeting:${value.foreignId}/${value.meeting.meeting.id}`, change),
    ).rejects.toMatchObject({ code: "not_found" })
    const participantId = value.meeting.participants[0]?.id
    if (!participantId) throw new Error("missing invented guest")
    const link = { action: "person.link" as const, participantId, personUid: value.target.uid, expectedPersonUid: null }
    await expect(integration.change(reference, link, { apply: true })).rejects.toMatchObject({ code: "not_found" })
    expect(
      await integration.change(reference, { ...link, targetAccountIds: [value.foreignId] }, { apply: true }),
    ).toMatchObject({
      applied: true,
      result: { personUid: value.target.uid, previousPersonUid: null, changed: true },
    })
  } finally {
    await connection.close()
  }
  const reopened = await openStore({ path: value.path, env: value.env })
  try {
    expect(await reopened.personSeenInAccounts(value.target.uid, [value.accountId])).toBe(true)
    expect((await reopened.storedAccounts()).map((account) => account.id)).toEqual([value.accountId, value.foreignId])
    expect(
      await reopened.meetings.meetingMetadata({ accountId: value.accountId, meetingId: value.meeting.meeting.id }),
    ).toMatchObject({ eventId: value.event.id })
  } finally {
    await reopened.close()
  }
})

it("resolves the existing account before WAV access and previews through real public speech metadata", async () => {
  const value = await fixture()
  const { audio, models } = audioFixture(value.directory)
  const connection = await createStoreConnector({ path: value.path, env: value.env })({
    ...request,
    capability: "transcript-append",
  })
  try {
    const capability = connection.meetingTranscription
    if (!capability) throw new Error("missing published local transcription capability")
    const options = { model: "parakeet-v3", modelsDirectory: models }
    const preview = await capability.transcribe(String(value.meeting.meeting.id), audio, options)
    expect(preview).toMatchObject({
      applied: false,
      accountId: value.accountId,
      media: { durationMs: 1000, recognition: { engine: "sherpa-onnx", model: "parakeet-v3" } },
    })
    await expect(
      capability.transcribe(
        `meeting:${value.foreignId}/${value.meeting.meeting.id}`,
        join(value.directory, "absent.wav"),
        options,
      ),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      capability.transcribe(String(value.meeting.meeting.id), audio, { ...options, apply: true }),
    ).rejects.toMatchObject({ code: "not_found", message: expect.stringContaining("not installed") })
    const exact = connection.appendTranscriptsWithReceipt
    if (!exact) throw new Error("missing public exact append")
    await expect(
      exact({ accountId: value.accountId, externalId: "absent-existing-occurrence", now: 3000, transcripts: [] }),
    ).rejects.toMatchObject({ code: "validation_error" })
  } finally {
    await connection.close()
  }
})

it("mounts real durable connector capabilities and rejects absent local profiles or legacy capabilities", async () => {
  const value = await fixture()
  const { audio, models } = audioFixture(value.directory)
  const output: string[] = []
  const errors: string[] = []
  const denied = async () => {
    throw new Error("unexpected external access")
  }
  const connect = createStoreConnector({ path: value.path, env: value.env })
  let connections = 0
  const deps: ProgramDeps = {
    configPath: join(value.directory, "config.json"),
    tokens: new TokenManager({
      clientId: "example-client",
      service: "example",
      keyring: memoryKeyring(),
      fetch: denied,
    }),
    fetch: denied,
    openBrowser: denied,
    connectStore: async (input) => {
      connections++
      return connect(input)
    },
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
  }
  const reference = `meeting:${value.accountId}/${value.meeting.meeting.id}`
  const links = ["meetings", "update", reference, "--event-id", String(value.event.id)]
  const search = ["search", "meetings", "example"]
  const transcribe = ["meetings", "transcribe", reference, audio, "--model", "parakeet-v3", "--models-dir", models]
  expect(await run([...search, "--json"], deps)).toBe(3)
  expect(await run([...transcribe, "--json"], deps)).toBe(3)
  expect(connections).toBe(0)
  setConfig(deps.configPath, "account.profile", request.profile)
  for (const command of [links, search, transcribe]) {
    expect(await run([...command, "--json"], deps)).toBe(0)
    expect(output.at(-1)).toBeDefined()
    if (command === search) {
      const found = JSON.parse(output.at(-1) ?? "{}")
      expect(found.items.length).toBeGreaterThan(0)
      expect(found.items.every((hit: { meeting_id: number }) => hit.meeting_id === value.meeting.meeting.id)).toBe(true)
      expect(found.coverage.indexing).toBe("ready")
    }
  }
  expect(connections).toBe(3)
  expect(await run([...links, "--yes", "--json"], deps)).toBe(0)
  for (const [event, hits] of [
    [value.event.id, true],
    [value.event.id + 1, false],
  ] as const) {
    expect(await run([...search, "--event-id", String(event), "--json"], deps)).toBe(0)
    expect(JSON.parse(output.at(-1) ?? "{}").items.length > 0).toBe(hits)
  }
  deps.connectStore = async () => ({ store: memoryMeetingStore(), accountId: value.accountId, close: async () => {} })
  for (const command of [links, search, transcribe]) {
    expect(await run([...command, "--json"], deps)).toBe(3)
    expect(errors.at(-1)).toContain("unavailable in this store connector")
  }
})

it("preserves legacy replay and rejects a metadata adapter that returns another account before audio access", async () => {
  const value = await fixture()
  const connection = await createStoreConnector({
    path: value.path,
    env: value.env,
    openStore: async (options) => {
      const store = await openStore(options)
      return {
        ...store,
        meetings: {
          ...store.meetings,
          meetingMetadata: async () => ({ ...value.meeting.meeting, accountId: value.foreignId }),
        },
      }
    },
  })(request)
  try {
    const append = connection.appendTranscripts
    const transcription = connection.meetingTranscription
    if (!append || !transcription) throw new Error("missing published transcript capabilities")
    const input = sampleMeeting().transcripts[0]
    if (!input.contentHash) throw new Error("missing invented transcript hash")
    const result = await append({
      accountId: value.accountId,
      externalId: value.meeting.meeting.externalId,
      now: 3000,
      transcripts: [
        {
          ...input,
          contentHash: input.contentHash,
          rows: input.rows.map(({ speakerParticipantPosition: _speaker, ...row }) => row),
        },
      ],
    })
    expect(result.transcripts).toHaveLength(1)
    await expect(
      transcription.transcribe(String(value.meeting.meeting.id), join(value.directory, "not-opened.wav"), {
        model: "parakeet-v3",
        modelsDirectory: join(value.directory, "not-opened-models"),
      }),
    ).rejects.toMatchObject({ code: "not_found" })
  } finally {
    await connection.close()
  }
})

it("searches confirmed project aliases and participant identities through the published shared service", async () => {
  const value = await fixture()
  const store = await openStore({ path: value.path, env: value.env, now: () => 3000 })
  try {
    const key = { provider: "zoom", account: request.externalId }
    const project = await store.knowledge.addProject({ name: "Research Example", key: "RES", scope: "work" })
    await store.knowledge.addVocabularyAlias({ kind: "project", id: project.id }, "исследование")
    await store.knowledge.linkMeetingProject(key, String(value.meeting.meeting.id), project.id)
    await store.knowledge.addTags(key, { type: "meeting", id: String(value.meeting.meeting.id) }, ["planning"])
    await store.meetings.indexSearch({ accountId: value.accountId })
  } finally {
    await store.close()
  }
  const connection = await createStoreConnector({ path: value.path, env: value.env })(request)
  try {
    const result = await connection.meetingSearch?.("example", {
      project: "исследование",
      tag: "planning",
      participantIdentityId: value.meeting.participants[0]?.identityId,
      since: 1000,
      until: 1000,
    })
    expect(result?.items.length).toBeGreaterThan(0)
    expect(result?.items.every((hit) => hit.meetingId === value.meeting.meeting.id)).toBe(true)
    expect(result).toMatchObject({
      selection: [
        { kind: "project", name: "Research Example", by: "explicit-link" },
        { kind: "tag", name: "planning" },
      ],
    })
    await expect(connection.meetingSearch?.("example", { project: "Research Exampl" })).rejects.toMatchObject({
      code: "not_found",
    })
  } finally {
    await connection.close()
  }
})
