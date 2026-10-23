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
  const directory = await mkdtemp(join(tmpdir(), "zm-test-meeting-searches-"))
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

it("saves a search with its options, runs it as search meetings does, and lists, shows and deletes it", async () => {
  const { deps, stdout } = await setup()
  const read = () => {
    const answer = JSON.parse(stdout.join(""))
    stdout.length = 0
    return answer
  }
  const save = ["work", "searches", "create", "Example-Plan", "example plan", "--since-time", "2026-10-01"]
  expect(await run([...save, "--limit", "5", "--json"], deps)).toBe(0)
  expect(read().item).toMatchObject({
    name: "example-plan",
    command: "meetings-search",
    params: { text: "example plan", since_time: "2026-10-01", limit: "5" },
    runs: 0,
  })
  expect(await run([...save, "--json"], deps)).toBe(2)
  stdout.length = 0
  expect(await run(["work", "searches", "run", "example-plan", "--json"], deps)).toBe(0)
  const hits = read()
  expect(hits.items).toHaveLength(1)
  expect(hits.items[0].excerpt).toMatch(/example plan/)
  expect(hits.page.limit).toBe(5)
  expect(await run(["work", "searches", "list", "--json"], deps)).toBe(0)
  expect(read().items.map((one: { name: string; runs: number }) => [one.name, one.runs])).toEqual([["example-plan", 1]])
  expect(await run(["work", "searches", "show", "example-plan", "--json"], deps)).toBe(0)
  expect(read().item.last_run_at).not.toBeNull()
  expect(await run(["work", "searches", "delete", "example-plan", "--json"], deps)).toBe(0)
  stdout.length = 0
  expect(await run(["work", "searches", "run", "example-plan", "--json"], deps)).toBe(6)
})

it("refuses options search meetings would refuse, before saving", async () => {
  const { deps } = await setup()
  const save = ["work", "searches", "create", "broken", "example"]
  expect(await run([...save, "--since-time", "not a date", "--json"], deps)).toBe(2)
  expect(await run([...save, "--max-chunks", "5", "--json"], deps)).toBe(0)
  expect(await run(["work", "searches", "run", "broken", "--json"], deps)).toBe(2)
})

it("saves every search meetings option it keeps, and replaces a saved search by name", async () => {
  const { deps, stdout } = await setup()
  const all = [
    ["--event-id", "999"],
    ["--project", "Absent example"],
    ["--topic", "Absent example"],
    ["--since-time", "2026-10-01"],
    ["--until-time", "2026-10-31"],
    ["--limit", "5"],
    ["--max-read-bytes", "1000"],
  ].flat()
  expect(await run(["work", "searches", "create", "everything", "example", ...all, "--json"], deps)).toBe(0)
  stdout.length = 0
  const meaning = ["--model", "example-model", "--base-url", "https://example.com/v1", "--dims", "8"]
  const bounds = ["--max-chunks", "5", "--max-rows", "5", "--max-text-bytes", "5"]
  const replace = ["work", "searches", "create", "everything", "example", ...meaning, ...bounds, "--replace"]
  expect(await run([...replace, "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).item.params).toMatchObject({ model: "example-model", max_chunks: "5" })
})

it("reads a relative date in a saved query at each run", async () => {
  const { deps, stdout } = await setup()
  expect(await run(["work", "searches", "create", "recent", "example plan date>=36500d", "--json"], deps)).toBe(0)
  stdout.length = 0
  expect(await run(["work", "searches", "run", "recent", "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).items).toHaveLength(1)
})
