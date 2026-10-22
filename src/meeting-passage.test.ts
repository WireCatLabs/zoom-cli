import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { openStore } from "@wirecat/cli-core/store"
import { expect, it, vi } from "vitest"
import { readReceipt } from "../scripts/testing/answers.js"
import { useProfile } from "../scripts/testing/profile.js"
import { type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const fixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-passage-"))
  const path = join(directory, "fixture.db")
  const env = { MESSAGING_STORE: path }
  const store = await openStore({ path, env, now: () => 3000 })
  try {
    const accountId = await store.accounts.saveAccount(
      { provider: "zoom", account: "zm-profile:AliceExample" },
      { name: "Alice Example" },
    )
    const input = sampleMeeting()
    input.meeting.accountId = accountId
    const first = input.transcripts[0].rows[0]
    input.transcripts[0].rows = [
      { ...first, position: 0, text: "Alice Example proposed a launch" },
      { ...first, position: 4, text: "Bob Sample agreed to review" },
      { ...first, position: 9, text: "Alice Example will follow up" },
    ]
    await store.meetings.saveMeeting(input)
    await store.meetings.indexSearch({ accountId })
    const hit = (await store.meetings.searchHits("agreed", { accountId })).items[0]
    if (!hit?.ref) throw Error("missing invented search hit")
    return { directory, path, env, reference: hit.ref }
  } finally {
    await store.close()
  }
}
const setup = async () => {
  const f = await fixture()
  const output: string[] = []
  const connect = createStoreConnector({ path: f.path, env: f.env })
  const close = vi.fn()
  const opened = vi.fn()
  const connectStore: ProgramDeps["connectStore"] = async (request) => {
    opened()
    const connection = await connect(request)
    return {
      ...connection,
      close: async () => {
        await connection.close()
        close()
      },
    }
  }
  const network = vi.fn(async () => {
    throw Error("unexpected network")
  })
  const deps: ProgramDeps = {
    configPath: join(f.directory, "config.json"),
    tokens: new TokenManager({ clientId: "example", keyring: memoryKeyring(), service: "example", fetch: network }),
    fetch: network,
    openBrowser: network,
    connectStore,
    data: (text) => output.push(text),
    diagnostic: () => {},
  }
  useProfile(deps.configPath, "AliceExample")
  return { ...f, deps, output, close, opened, network }
}
it("projects cited cues while retaining coverage, source and execution metadata", async () => {
  const f = await setup()
  expect(
    await run(
      [
        "meetings",
        "passage",
        f.reference,
        "--before-n",
        "1",
        "--after-n",
        "1",
        "--json=items.ref,items.start_ms,items.speaker_name,items.text",
      ],
      f.deps,
    ),
  ).toBe(0)
  const answer = JSON.parse(f.output.join(""))
  expect(answer.meta).toMatchObject({ complete: true })
  expect(answer.item).toMatchObject({ target_ref: f.reference, coverage: { included: 3 } })
  expect(answer.item.items).toHaveLength(3)
  expect(answer.item.items[0]).toHaveProperty("ref")
  expect(answer.item.items[0]).not.toHaveProperty("fingerprint")
  expect(answer.item.items[0]).not.toHaveProperty("content_hash")
  expect(f.network).not.toHaveBeenCalled()
})
it("opens published search-hit context as Markdown or structured JSON and closes before output", async () => {
  const f = await setup()
  f.deps.data = (text) => {
    expect(f.close).toHaveBeenCalled()
    f.output.push(text)
  }
  expect(
    await run(
      ["meetings", "passage", f.reference, "--before-n", "1", "--after-n", "1", "--format", "markdown"],
      f.deps,
    ),
  ).toBe(0)
  expect(f.output.join("")).toContain("Alice Example proposed a launch")
  expect(f.output.join("")).toContain(`\`${f.reference}\``)
  expect(f.opened).toHaveBeenCalledOnce()
  expect(f.close).toHaveBeenCalledOnce()
  f.output.length = 0
  expect(
    await run(
      ["meetings", "passage", f.reference, "--before-n", "0", "--after-n", "0", "--format", "markdown", "--json"],
      f.deps,
    ),
  ).toBe(0)
  const packet = readReceipt(f.output.join(""))
  expect(packet).toMatchObject({
    kind: "meeting_context",
    target_ref: f.reference,
    coverage: { included: 1, has_before: true, has_after: true, archive_completeness: "unknown" },
  })
  expect(packet.items[0].text).toBe("Bob Sample agreed to review")
  f.output.length = 0
  expect(
    await run(["meetings", "passage", f.reference, "--expected-fingerprint", "0".repeat(64), "--json"], f.deps),
  ).not.toBe(0)
  expect(f.output).toEqual([])
  expect(await run(["meetings", "passage", f.reference, "--max-read-bytes", "1", "--json"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(await run(["meetings", "passage", f.reference, "--bytes", "2", "--json"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(await run(["meetings", "passage", f.reference, "--fields", "target_ref"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(await run(["meetings", "passage", f.reference, "--jsonl"], f.deps)).toBe(0)
  expect(readReceipt(f.output.join(""))).toMatchObject({ kind: "meeting_context", coverage: { included: 3 } })
  f.output.length = 0
  f.network.mockClear()
  f.opened.mockClear()
  expect(await run(["meetings", "passage", f.reference, "--before-n", "-1"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(f.network).not.toHaveBeenCalled()
  expect(f.opened).not.toHaveBeenCalled()
})
it("answers a passage reference from another account as not found and still closes", async () => {
  const f = await setup()
  const errors: string[] = []
  f.deps.diagnostic = (text) => errors.push(text)
  const foreign = f.reference.replace(/^meeting:\d+\//, "meeting:999/")
  expect(await run(["meetings", "passage", foreign, "--json"], f.deps)).not.toBe(0)
  expect(f.output).toEqual([])
  expect(errors.join("")).toContain("not_found")
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.network).not.toHaveBeenCalled()
})
