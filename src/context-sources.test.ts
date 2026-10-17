import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { readConfig, setConfig } from "./config.js"

const path = () => join(mkdtempSync(join(tmpdir(), "zm-context-config-")), "config.json")
const source = { id: "work-messages", kind: "message", provider: "example-messenger", account: "AliceExample" }

it("keeps explicit profile grants separate, persists snake_case and permits revocation", () => {
  const file = path()
  expect(() => setConfig(file, "context.sources", JSON.stringify([source]))).toThrow(/account.profile/)
  setConfig(file, "account.profile", "ResearchExample")
  setConfig(file, "context.sources", JSON.stringify([source]))
  setConfig(file, "account.profile", "OtherExample")
  setConfig(file, "context.sources", JSON.stringify([{ ...source, account: "BobSample" }]))
  expect(readConfig(file).contextSources).toEqual([
    { ...source, profile: "ResearchExample" },
    { ...source, account: "BobSample", profile: "OtherExample" },
  ])
  expect(JSON.parse(readFileSync(file, "utf8"))).toHaveProperty("context_sources")
  setConfig(file, "context.sources", "[]")
  expect(readConfig(file).contextSources).toEqual([{ ...source, profile: "ResearchExample" }])
})

it("refuses malformed, broadened and duplicate grant definitions without changing configuration", () => {
  const file = path()
  setConfig(file, "account.profile", "ResearchExample")
  const before = readFileSync(file, "utf8")
  for (const value of [
    "not-json",
    JSON.stringify({ source }),
    JSON.stringify([{ ...source, chat_ids: ["room"] }]),
    JSON.stringify([{ ...source, profile: "foreign" }]),
    JSON.stringify([{ ...source, account_id: 1 }]),
    JSON.stringify([source, source]),
    JSON.stringify([source, { ...source, id: "alias" }]),
    JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ ...source, id: `s${i}`, account: `a${i}` }))),
  ]) {
    expect(() => setConfig(file, "context.sources", value)).toThrow()
    expect(readFileSync(file, "utf8")).toBe(before)
  }
})
