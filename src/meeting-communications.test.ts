import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { expect, it, vi } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { communicationsFixture } from "../scripts/testing/communications.js"
import { now } from "../scripts/testing/preparation.js"
import { setConfig } from "./config.js"
import { run } from "./program.js"

const selections = ["work-messages", "work-mail", "project-files"]
const input = {
  series_id: "123",
  communications: {
    sources: selections.map((id) => ({ id })),
    query: "launch",
    after: new Date(now - 13 * 86400000).toISOString(),
    before: new Date(now - 3600000).toISOString(),
  },
}

it("joins conflicting dated statements without writing or inferring a winner", async () => {
  const f = await communicationsFixture()
  const digest = () => createHash("sha256").update(readFileSync(f.path)).digest("hex"),
    before = digest()
  const args = [
    "meetings",
    "prepare",
    "123",
    "--context-query",
    "launch",
    "--context-since-time",
    input.communications.after,
    "--context-before-time",
    input.communications.before,
    "--json",
  ]
  for (const id of selections) args.push("--context-source", id)
  expect(await run(args, f.deps)).toBe(0)
  const item = readAnswer(f.output.join("")),
    section = item.communications
  expect(section.coverage.window).toEqual({ after: input.communications.after, before: input.communications.before })
  expect(section.items).toHaveLength(3)
  expect(section.items.map((i: { text: string }) => i.text)).toEqual([
    "Launch Friday: target Monday.",
    "Launch Monday: target Tuesday.",
    "Launch Tuesday: target Wednesday.",
  ])
  expect(new Set(section.items.map((i: { ref: string }) => i.ref)).size).toBe(3)
  expect(section.coverage.sources.map((s: { state: string }) => s.state)).toEqual(["searched", "searched", "searched"])
  expect(JSON.stringify(section)).not.toContain("BobSample")
  expect(f.connectStore).toHaveBeenCalledWith(expect.objectContaining({ intent: "preparation" }))
  expect(f.network).toHaveBeenCalledOnce()
  expect(f.closed).toHaveBeenCalledOnce()
  expect(digest()).toBe(before)
})

it("rejects an unconfigured selection before credentials, database opening or Zoom reads", async () => {
  const f = await communicationsFixture(),
    load = vi.spyOn(f.tokens.options.keyring, "get")
  expect(
    await run(
      ["meetings", "prepare", "123", "--context-source", "foreign", "--context-query", "launch", "--json"],
      f.deps,
    ),
  ).not.toBe(0)
  expect(f.connectStore).not.toHaveBeenCalled()
  expect(f.network).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it("keeps source coverage when the caller projects only excerpt references", async () => {
  const f = await communicationsFixture()
  expect(
    await run(
      [
        "meetings",
        "prepare",
        "123",
        "--context-source",
        "work-messages",
        "--context-query",
        "launch",
        "--json=communications.items.ref",
      ],
      f.deps,
    ),
  ).toBe(0)
  const section = readAnswer(f.output.join("")).communications
  expect(section.items).toHaveLength(1)
  expect(Object.keys(section.items[0])).toEqual(["ref"])
  expect(section.coverage.sources[0]).toMatchObject({ selection_id: "work-messages", state: "searched" })
})

it("does not let an unavailable unrequested configured source block a valid source", async () => {
  const f = await communicationsFixture()
  setConfig(
    f.deps.configPath,
    "context.sources",
    JSON.stringify(
      f.sources.map((source) => (source.id === "project-files" ? { ...source, account: "notes:9000000" } : source)),
    ),
    () => "AliceExample",
  )
  expect(
    await run(
      ["meetings", "prepare", "123", "--context-source", "work-messages", "--context-query", "launch", "--json"],
      f.deps,
    ),
  ).toBe(0)
  const section = readAnswer(f.output.join("")).communications
  expect(section.items).toHaveLength(1)
  expect(section.coverage.sources).toHaveLength(1)
  expect(section.coverage.sources[0]).toMatchObject({ selection_id: "work-messages", state: "searched" })
})
