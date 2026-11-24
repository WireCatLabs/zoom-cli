import { copyFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { openStore } from "@wirecat/cli-core/store"
import type { Command } from "commander"
import { expect, it } from "vitest"
import { declaredAnswerIssue } from "../scripts/testing/answers.js"
import { useProfile } from "../scripts/testing/profile.js"
import { ZOOM_ANSWER_ENTITIES } from "./answer-entities.js"
import { profileAccountKey, setConfig } from "./config.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

/** Housekeeping answers describe the tool; every data command must declare a schema. */
const HOUSEKEEPING_ANSWERS = new Set([
  "commands",
  "commands info",
  "complete",
  "config migrate",
  "config set",
  "config show",
  "config unset",
  "doctor",
  "doctor reports create",
  "doctor reports show",
  "guide",
  "help",
  "mcp add",
  "mcp check",
  "mcp config",
  "mcp revoke",
  "mcp serve",
  "mcp server start",
  "mcp server status",
  "mcp server stop",
  "session end",
  "session list",
  "session start",
  "session status",
  "skill install",
  "skill show",
  "skill status",
  "upgrade",
])

const seed = async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-answer-entities-seed-"))
  const path = join(directory, "store.db")
  const store = await openStore({ path, env: { MESSAGING_STORE: path, HOME: directory } })
  const account = await store.accounts.saveAccount(
    { provider: "zoom", account: profileAccountKey("AliceExample") },
    { name: "Alice Example" },
  )
  const sample = sampleMeeting()
  const startedAt = Date.parse("2026-10-19T10:00:00Z")
  const saved = await store.meetings.saveMeeting({
    ...sample,
    meeting: { ...sample.meeting, accountId: account, startedAt, endedAt: startedAt + 3600000 },
    chat: [{ ...sample.chat[0], text: "The plan is at https://example.com/plan" }],
  })
  await store.meetings.indexSearch({ accountId: account })
  await store.meetings.createEvent(
    {
      eventSeriesId: null,
      title: "Example planning",
      description: null,
      location: null,
      startsAt: startedAt,
      endsAt: null,
      timezone: "UTC",
      origin: "owner",
      deletedAt: null,
    },
    startedAt,
  )
  const profile = { provider: "zoom", account: profileAccountKey("AliceExample") }
  await store.people.savePeople(profile, [{ id: "alice-example", name: "Alice Example" }])
  const person = await store.people.personOf({ provider: "zoom", id: "alice-example" })
  await store.close()
  return { path, meeting: String(saved.meeting.id), person: `person:${person?.uid}` }
}

// Migrating and filling the store is most of a fixture's cost, so the tests copy one filled store.
let seeded: ReturnType<typeof seed> | undefined
const seedOnce = () => {
  seeded ??= seed()
  return seeded
}

const fixture = async () => {
  const filled = await seedOnce()
  const directory = mkdtempSync(join(tmpdir(), "zm-test-answer-entities-"))
  const path = join(directory, "store.db")
  copyFileSync(filled.path, path)
  const env: NodeJS.ProcessEnv = { MESSAGING_STORE: path, HOME: directory }
  const stdout: string[] = []
  const network = async () => {
    throw new Error("unexpected network")
  }
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    env,
    tokens: new TokenManager({ clientId: "", keyring: memoryKeyring(), service: "example", fetch: network }),
    fetch: network,
    connectStore: createStoreConnector({ path, env }),
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: () => {},
  }
  setConfig(deps.configPath, "files.timezone", "UTC")
  useProfile(deps.configPath, "AliceExample", env)
  const answer = async (argv: string[]) => {
    stdout.length = 0
    const json = argv.some((word) => word.startsWith("--json")) ? [] : ["--json"]
    expect(await run([...argv, ...json], deps), argv.join(" ")).toBe(0)
    return JSON.parse(stdout.join("")) as Record<string, unknown> & { items?: { ref: string }[] }
  }
  return { deps, answer, path, env, meeting: filled.meeting, person: filled.person }
}

const leaves = (command: Command): Command[] =>
  command.commands.length ? command.commands.flatMap(leaves) : command.parent ? [command] : []
const pathOf = (command: Command) => {
  const words: string[] = []
  for (let at: Command | null = command; at?.parent; at = at.parent) words.unshift(at.name())
  return words.join(" ")
}

const SINCE = ["--since-time", "2026-10-01"]
/** `{meeting}`, `{person}`, `{passage}` and `{meetingRef}` stand for refs read from the fixture's answers. */
const ANSWERS: Record<string, [string, string[]][]> = {
  meetings: [
    ["meetings list", ["meetings", "list"]],
    ["meetings show", ["meetings", "show", "{meeting}"]],
    ["meetings transcript", ["meetings", "transcript", "{meeting}"]],
    ["meetings summary", ["meetings", "summary", "{meeting}"]],
    ["meetings people", ["meetings", "people", "alice"]],
    ["meetings passage", ["meetings", "passage", "{passage}", "--format", "json"]],
    ["meetings task-proposal", ["meetings", "task-proposal", "{passage}", "--type", "promise"]],
    ["meetings evidence", ["meetings", "evidence", "{meetingRef}"]],
    ["meetings context", ["meetings", "context", "{person}"]],
  ],
  search: [
    ["search all", ["search", "all", "example"]],
    ["search meetings", ["search", "meetings", "example plan"]],
    ["searches create", ["searches", "create", "weekly", "example plan"]],
    ["searches list", ["searches", "list"]],
    ["searches show", ["searches", "show", "weekly"]],
    ["searches run", ["searches", "run", "weekly"]],
    ["searches delete", ["searches", "delete", "weekly"]],
  ],
  other: [
    ["events list", ["events", "list"]],
    ["review", ["review", ...SINCE]],
    ["stats meetings show", ["stats", "meetings", "show", ...SINCE]],
    ["stats meetings top", ["stats", "meetings", "top", ...SINCE]],
    ["stats meetings history", ["stats", "meetings", "history", "--by", "week", ...SINCE]],
    ["mentions list", ["mentions", "list", "started_at>=2026-10-01"]],
    ["store info", ["store", "info"]],
  ],
}

// One store for the three groups keeps each test short on a slow runner; each group leaves the data as it found it.
const answering = async () => {
  const { deps, answer, meeting, person } = await fixture()
  const passage = (await answer(["search", "meetings", "example plan"])).items?.[0]?.ref ?? ""
  const meetingRef = (await answer(["meetings", "list"])).items?.[0]?.ref ?? ""
  const refs: Record<string, string> = { meeting, person, passage, meetingRef }
  return { deps, answer, refs, program: createProgram(deps) }
}
let shared: ReturnType<typeof answering> | undefined
const answeringOnce = () => {
  shared ??= answering()
  return shared
}

it.each(Object.entries(ANSWERS))("answers the %s commands with their declared entity's schema", async (_, runs) => {
  const { answer, refs, program } = await answeringOnce()
  for (const [path, argv] of runs) {
    const body = await answer(argv.map((word) => word.replace(/^\{(\w+)\}$/, (_, name: string) => refs[name] ?? "")))
    expect(body.items?.length ?? 1, `${path} answers something to check`).toBeGreaterThan(0)
    expect(declaredAnswerIssue(program, path, body), path).toBeUndefined()
  }
})

it("checks the answer of every command that declares an entity", async () => {
  const { program } = await answeringOnce()
  const commands = new Map(leaves(program).map((command) => [pathOf(command), command]))
  const declared = [...commands.keys()].filter((path) => metaOf(commands.get(path) as Command).output)
  const answered = Object.values(ANSWERS).flatMap((runs) => runs.map(([path]) => path))
  expect(declared.sort()).toEqual(
    [...answered, "meetings projects evidence", "meetings projects scan", "meetings prepare"]
      // checked where their own fixtures are: account-removal, offline-archive-cli, meeting-project-evidence,
      // contacts, runs and the preparation tests; the management writes in cli-execution and permissions
      .concat(
        [
          "meetings create",
          "meetings update",
          "meetings cancel",
          "meetings invitation",
          "account remove",
          "meetings scheduled",
          "search recordings",
          "models list",
          "models download",
          "meetings status",
          "recordings status",
          "batch",
          "contacts list",
          "contacts show",
          "runs list",
          "runs show",
          "runs path",
        ],
        Object.keys(ZOOM_ANSWER_ENTITIES),
      )
      .sort(),
  )
  expect([...commands.keys()].filter((path) => !declared.includes(path) && !HOUSEKEEPING_ANSWERS.has(path))).toEqual([])
})

it("keeps search meetings fields asked of a saved search", async () => {
  const { answer } = await fixture()
  await answer(["searches", "create", "weekly", "example plan"])
  const kept = await answer(["searches", "run", "weekly", "--json=scope,offset_ms"])
  expect(Object.keys(kept.items?.[0] ?? {}).sort()).toEqual(["offset_ms", "scope", "untrusted"])
})

it("stats meetings history with --no-record keeps no search", async () => {
  const { answer, path, env } = await fixture()
  const searches = async () => {
    const store = await openStore({ path, env })
    try {
      return (await store.searches.searchHistory(1000)).items.length
    } finally {
      await store.close()
    }
  }
  const before = await searches()
  const body = await answer(["stats", "meetings", "history", "--by", "week", "--no-record"])
  expect(body.item).toMatchObject({ by: "week", meetings: 1, transcripts: 1 })
  expect(await searches()).toBe(before)
})
