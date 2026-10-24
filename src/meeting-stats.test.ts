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
  const directory = await mkdtemp(join(tmpdir(), "zm-test-meeting-stats-"))
  const store = join(directory, "store.db")
  const env: NodeJS.ProcessEnv = { MESSAGING_STORE: store, HOME: directory }
  const stdout: string[] = []
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
    diagnostic: () => {},
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
  return { deps, stdout }
}

it("shows talk time by week and the top speakers, without any transcript text", async () => {
  const { deps, stdout } = await setup()
  expect(await run(["work", "stats", "meetings", "show", "--timezone", "UTC", "--json"], deps)).toBe(0)
  const answer = JSON.parse(stdout.join(""))
  expect(answer.item).toMatchObject({ time_zone: "UTC", meetings: 2, lines: 3, words: 7, talk_ms: 7000 })
  expect(answer.item.weeks).toEqual([
    { week_start: "2026-10-19", meetings: 1, talk_ms: 5000 },
    { week_start: "2026-10-26", meetings: 1, talk_ms: 2000 },
  ])
  expect(answer.item.top_speakers[0]).toMatchObject({ name: "Alice Example", meetings: 2, talk_ms: 6000 })
  expect(stdout.join("")).not.toContain("example plan")
})

it("lists speakers by talk time over the filtered meetings", async () => {
  const { deps, stdout } = await setup()
  const args = ["work", "stats", "meetings", "top", "--since-time", "2026-10-18", "--until-time", "2026-10-20"]
  expect(await run([...args, "--timezone", "UTC", "--limit", "1", "--json"], deps)).toBe(0)
  const answer = JSON.parse(stdout.join(""))
  expect(answer.items).toEqual([expect.objectContaining({ name: "Alice Example", talk_ms: 4000, share: 0.8 })])
  expect(answer.page.has_more).toBe(true)
  stdout.length = 0
  expect(await run(["work", "stats", "meetings", "top", "--timezone", "Mars/Base", "--json"], deps)).toBe(2)
})

it("takes every filter on both commands, and says when a project or topic name is unknown", async () => {
  const { deps, stdout } = await setup()
  for (const command of ["show", "top"]) {
    const window = ["--since-time", "2026-10-01", "--until-time", "2026-10-31", "--max-rows", "100"]
    expect(await run(["work", "stats", "meetings", command, ...window, "--event-id", "999", "--json"], deps)).toBe(0)
    const answer = JSON.parse(stdout.join(""))
    expect(command === "show" ? answer.item.meetings : answer.items).toEqual(command === "show" ? 0 : [])
    stdout.length = 0
    for (const name of ["--project", "--topic-name"])
      expect(await run(["work", "stats", "meetings", command, name, "Absent example", "--json"], deps)).toBe(6)
  }
})
