import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { expect, it } from "vitest"
import { useProfile } from "../scripts/testing/profile.js"
import { setConfig } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const vtt = (lines: [string, string, string, string][]) =>
  `WEBVTT\n\n${lines.map(([n, from, to, text]) => `${n}\n${from} --> ${to}\n${text}\n`).join("\n")}`

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-meeting-review-"))
  const store = join(directory, "store.db")
  const env: NodeJS.ProcessEnv = { MESSAGING_STORE: store, HOME: directory }
  const stdout: string[] = []
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    env,
    tokens: new TokenManager({ clientId: "", keyring: memoryKeyring(), service: "example", fetch }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    connectStore: createStoreConnector({ path: store, env }),
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
  }
  setConfig(deps.configPath, "files.timezone", "UTC")
  useProfile(deps.configPath, "work", env)
  const transcripts = join(directory, "transcripts")
  await mkdir(transcripts)
  await writeFile(
    join(transcripts, "2026-10-19_1000_example-planning.vtt"),
    vtt([
      ["1", "00:00:00.000", "00:00:04.000", "Alice Example: We ship the example plan"],
      ["2", "00:00:04.000", "00:00:05.000", "Bob Sample: Fine"],
    ]),
  )
  await writeFile(
    join(transcripts, "2026-10-27_1000_example-review.vtt"),
    vtt([["1", "00:00:00.000", "00:00:02.000", "Alice Example: Reviewed"]]),
  )
  expect(await run(["work", "meetings", "import", transcripts, "--json"], deps)).toBe(0)
  stdout.length = 0
  return { deps, stdout, stderr }
}

it("reviews the meetings since a point: newest first, talk and transcript size, and says what is missing", async () => {
  const { deps, stdout } = await setup()
  expect(await run(["work", "review", "--since-time", "2026-10-01", "--json"], deps)).toBe(0)
  const answer = JSON.parse(stdout.join(""))
  expect(answer.items.map((one: { title: string }) => one.title)).toEqual(["example review", "example planning"])
  expect(answer.items[1]).toMatchObject({
    transcript: { lines: 2, words: 6 },
    speakers: [
      { name: "Alice Example", talk_ms: 4000 },
      { name: "Bob Sample", talk_ms: 1000 },
    ],
    summary: null,
  })
  expect(answer.missing.map((one: { why: string }) => one.why)).toEqual([
    expect.stringContaining("2 meetings have no summary"),
    expect.stringContaining("2 transcripts hold fewer than 50 words"),
  ])
  stdout.length = 0
  expect(await run(["work", "review", "--since-time", "2026-10-20", "--limit", "1", "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).items).toHaveLength(1)
})

it("says no chat is stored when there are no links to list", async () => {
  const { deps, stdout } = await setup()
  expect(await run(["work", "mentions", "list", "--json"], deps)).toBe(0)
  const answer = JSON.parse(stdout.join(""))
  expect(answer.items).toEqual([])
  expect(answer.missing[0].why).toMatch(/no meeting chat is stored/)
})

it("pushes review selectors and native mention queries into the stored read", async () => {
  const { deps, stdout, stderr } = await setup()
  for (const command of [
    ["review", "--limit", "5"],
    ["mentions", "list", "--limit", "5", "--max-messages", "100"],
  ]) {
    const mention = command[0] === "mentions"
    const window = mention
      ? ["started_at:[2026-10-01 TO 2026-10-31]", "--timezone", "UTC"]
      : ["--since-time", "2026-10-01", "--until-time", "2026-10-31", "--timezone", "UTC"]
    const result = await run(
      ["work", ...command, ...window, ...(mention ? ["event_id:999"] : ["--event-id", "999"]), "--json"],
      deps,
    )
    expect(result, stderr.join("\n")).toBe(0)
    expect(JSON.parse(stdout.join("")).items).toEqual([])
    stdout.length = 0
    for (const [flag, field] of [
      ["--project", "project"],
      ["--topic-name", "topic"],
    ] as const)
      expect(
        await run(
          ["work", ...command, ...(mention ? [`${field}:"Absent example"`] : [flag, "Absent example"]), "--json"],
          deps,
        ),
      ).toBe(6)
  }
})
