import { mkdtempSync } from "node:fs"
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
import { profileAccountKey, setConfig } from "./config.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

/** Commands that answer about the CLI rather than the owner's data, or whose type is still to be written (DEBT-157). */
const UNDECLARED = new Set([
  "batch",
  "commands",
  "complete",
  "config set",
  "config show",
  "doctor",
  "guide",
  "help",
  "mcp",
  "meetings embeddings",
  "meetings export",
  "meetings import",
  "meetings link",
  "meetings sync",
  "meetings transcribe",
  "meetings update",
  "models download",
  "recordings archive check",
  "recordings archive import",
  "recordings archive locks",
  "recordings archive recover",
  "recordings archive show",
  "recordings archive transcript",
  "recordings download",
  "recordings list",
  "recordings schedule create",
  "recordings schedule disable",
  "recordings schedule list",
  "recordings schedule run",
  "recordings schedule show",
  "recordings show",
  "recordings sync",
  "remote-meetings cancel",
  "remote-meetings create",
  "remote-meetings invitation",
  "remote-meetings list",
  "remote-meetings show",
  "remote-meetings update",
  "serve",
  "session start",
  "session status",
  "skill install",
  "skill show",
  "upgrade",
  "watch",
])

const fixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-answer-entities-"))
  const path = join(directory, "store.db")
  const env: NodeJS.ProcessEnv = { MESSAGING_STORE: path, HOME: directory }
  const store = await openStore({ path, env })
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
  return { deps, answer, meeting: String(saved.meeting.id), person: `person:${person?.uid}` }
}

const leaves = (command: Command): Command[] =>
  command.commands.length ? command.commands.flatMap(leaves) : command.parent ? [command] : []
const pathOf = (command: Command) => {
  const words: string[] = []
  for (let at: Command | null = command; at?.parent; at = at.parent) words.unshift(at.name())
  return words.join(" ")
}

it("answers every command that declares an entity with that entity's schema", async () => {
  const { deps, answer, meeting, person } = await fixture()
  const passage = (await answer(["search", "meetings", "example plan"])).items?.[0]?.ref ?? ""
  const meetingRef = (await answer(["meetings", "list"])).items?.[0]?.ref ?? ""
  const runs: [string, string[]][] = [
    ["meetings list", ["meetings", "list"]],
    ["meetings show", ["meetings", "show", meeting]],
    ["meetings transcript", ["meetings", "transcript", meeting]],
    ["meetings summary", ["meetings", "summary", meeting]],
    ["meetings people", ["meetings", "people", "alice"]],
    ["meetings passage", ["meetings", "passage", passage, "--format", "json"]],
    ["meetings task-proposal", ["meetings", "task-proposal", passage, "--type", "promise"]],
    ["meetings evidence", ["meetings", "evidence", meetingRef]],
    ["meetings context", ["meetings", "context", person]],
    ["events list", ["events", "list"]],
    ["search all", ["search", "all", "example"]],
    ["search meetings", ["search", "meetings", "example plan"]],
    ["searches create", ["searches", "create", "weekly", "example plan"]],
    ["searches list", ["searches", "list"]],
    ["searches show", ["searches", "show", "weekly"]],
    ["searches run", ["searches", "run", "weekly"]],
    ["searches delete", ["searches", "delete", "weekly"]],
    ["review", ["review", "--since-time", "2026-10-01"]],
    ["stats meetings show", ["stats", "meetings", "show", "--since-time", "2026-10-01"]],
    ["stats meetings top", ["stats", "meetings", "top", "--since-time", "2026-10-01"]],
    ["mentions list", ["mentions", "list", "--since-time", "2026-10-01"]],
    ["models list", ["models", "list"]],
  ]
  const program = createProgram(deps)
  const commands = new Map(leaves(program).map((command) => [pathOf(command), command]))
  for (const [path, argv] of runs) {
    const body = await answer(argv)
    expect(body.items?.length ?? 1, `${path} answers something to check`).toBeGreaterThan(0)
    expect(declaredAnswerIssue(program, path, body), path).toBeUndefined()
  }
  const declared = [...commands.keys()].filter((path) => metaOf(commands.get(path) as Command).output)
  expect(declared.sort()).toEqual(
    [...runs.map(([path]) => path), "meetings projects evidence", "meetings projects scan", "meetings prepare"]
      // checked where their own fixtures are: offline-archive-cli, meeting-project-evidence and the preparation tests
      .concat(["meetings scheduled", "search recordings"])
      .sort(),
  )
  expect([...commands.keys()].filter((path) => !declared.includes(path) && !UNDECLARED.has(path))).toEqual([])
})

it("keeps search meetings fields asked of a saved search", async () => {
  const { answer } = await fixture()
  await answer(["searches", "create", "weekly", "example plan"])
  const kept = await answer(["searches", "run", "weekly", "--json=scope,offset_ms"])
  expect(Object.keys(kept.items?.[0] ?? {}).sort()).toEqual(["offset_ms", "scope"])
})
