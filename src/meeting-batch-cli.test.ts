import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { openStore } from "@wirecat/cli-core/store"
import { expect, it, vi } from "vitest"
import { fakeConnection } from "../scripts/testing/connection.js"
import { setConfig } from "./config.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { createStoreConnector } from "./store-connection.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-batch-"))
  const output: string[] = [],
    errors: string[] = []
  const fail = async () => {
    throw new Error("unexpected external access")
  }
  const connect = vi.fn(fail)
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({ clientId: "fixture", service: "fixture", keyring: memoryKeyring(), fetch: fail }),
    fetch: fail,
    openBrowser: fail,
    connectStore: connect,
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
    readBatchInput: async () => '{"requests":[]}',
  }
  return { directory, output, errors, connect, deps }
}
const requests = (...rows: { id: string; command: string[]; args: string[] }[]) => JSON.stringify({ requests: rows })

it("rejects malformed batches and nested writes before config, store or credentials", async () => {
  const f = await setup()
  await writeFile(f.deps.configPath, "invalid config")
  for (const text of [
    "not JSON",
    requests({ id: "write", command: ["meetings", "sync"], args: [] }),
    requests({ id: "q", command: ["search", "meetings"], args: ["budget", "--model", "remote"] }),
  ]) {
    f.deps.readBatchInput = async () => text
    expect(await run(["batch", "-", "--json"], f.deps)).toBe(2)
  }
  expect(f.connect).not.toHaveBeenCalled()
  expect(f.output).toEqual([])
})

it("reuses one connection, closes before stdout and emits independent real store answers", async () => {
  const f = await setup(),
    path = join(f.directory, "store.db")
  const store = await openStore({ path, env: { MESSAGING_STORE: path } })
  const accountId = await store.saveAccount(
    { provider: "zoom", account: "zm-profile:AliceExample" },
    { name: "Alice Example" },
  )
  const data = sampleMeeting()
  data.meeting.accountId = accountId
  data.transcripts[0].rows[0].text = "budget sample"
  const saved = await store.meetings.saveMeeting(data)
  const transcriptId = saved.transcripts[0]?.transcript.id
  if (!transcriptId) throw Error("missing fixture transcript")
  const ref = `meeting:${accountId}/${saved.meeting.id}/${transcriptId}/0`
  const index = vi.spyOn(store.meetings, "indexSearch"),
    nativeClose = store.close.bind(store)
  let closed = false
  const close = vi.spyOn(store, "close").mockImplementation(async () => {
    await nativeClose()
    closed = true
  })
  f.deps.connectStore = vi.fn(
    createStoreConnector({ path, env: { MESSAGING_STORE: path }, openStore: async () => store }),
  )
  f.deps.data = (text) => {
    expect(closed).toBe(true)
    f.output.push(text)
  }
  setConfig(f.deps.configPath, "account.profile", "AliceExample")
  f.deps.readBatchInput = async () =>
    requests(
      { id: "q1", command: ["search", "meetings"], args: ["budget"] },
      { id: "p1", command: ["meetings", "passage"], args: [ref] },
      { id: "q2", command: ["search", "meetings"], args: ["sample"] },
    )
  expect(await run(["batch", "-", "--json=items.ref,items.text"], f.deps)).toBe(0)
  expect(f.deps.connectStore).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)
  expect(index).toHaveBeenCalledTimes(1)
  const answer = JSON.parse(f.output.join(""))
  expect(answer.items.map((item: { id: string }) => item.id)).toEqual(["q1", "p1", "q2"])
  expect(answer.items[1]).toMatchObject({
    id: "p1",
    status: "ok",
    answer: { item: { items: [{ ref, text: "budget sample" }], coverage: { archive_completeness: "unknown" } } },
  })
  expect(answer.items[1].answer.item.items[0]).not.toHaveProperty("fingerprint")
  expect(answer.meta.complete).toBe(true)
})

it("identifies all read-budget refusals and ends JSONL incomplete without opening a store", async () => {
  const f = await setup()
  f.deps.readBatchInput = async () =>
    requests(
      { id: "q", command: ["search", "meetings"], args: ["budget"] },
      { id: "p", command: ["meetings", "passage"], args: ["meeting:1/1/1/0"] },
    )
  expect(await run(["batch", "-", "--max-read-bytes", "1", "--jsonl"], f.deps)).toBe(0)
  const records = f.output
    .join("")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(records.map((record) => record.type)).toEqual(["item", "item", "end"])
  expect(records[0].data).toMatchObject({ id: "q", status: "not_run" })
  expect(records[2]).toMatchObject({ complete: false })
  expect(f.connect).not.toHaveBeenCalled()
})

it("cancels cooperatively, closes once and prints no successful stream", async () => {
  const f = await setup(),
    controller = new AbortController(),
    close = vi.fn(async () => {})
  const read = vi.fn(async () => {
    controller.abort(new CliError("cancelled", "stop"))
    throw controller.signal.reason
  })
  f.deps.signal = controller.signal
  f.deps.connectStore = vi.fn(async () =>
    fakeConnection({ accountId: 1, close, meetingBatch: { passage: read, search: read, index: read } }),
  )
  setConfig(f.deps.configPath, "account.profile", "AliceExample")
  f.deps.readBatchInput = async () => requests({ id: "p", command: ["meetings", "passage"], args: ["meeting:1/1/1/0"] })
  expect(await run(["batch", "-", "--jsonl"], f.deps)).not.toBe(0)
  expect(close).toHaveBeenCalledTimes(1)
  expect(f.output).toEqual([])
})

it("advertises only the registered read paths without opening a store", async () => {
  const f = await setup(),
    program = createProgram(f.deps)
  expect(program.commands.find((command) => command.name() === "batch")?.description()).toContain(
    "search meetings and meetings passage",
  )
  expect(f.connect).not.toHaveBeenCalled()
})

it("formats correlated budget refusals as Markdown without opening the store", async () => {
  const f = await setup()
  f.deps.readBatchInput = async () => requests({ id: "q", command: ["search", "meetings"], args: ["budget"] })
  expect(await run(["batch", "-", "--max-read-bytes", "1", "--format", "markdown"], f.deps)).toBe(0)
  expect(f.output.join("")).toContain("q: search meetings")
  expect(f.output.join("")).toContain("not_run:")
  expect(f.connect).not.toHaveBeenCalled()
})

it("discards buffered batch output when closing the selected store fails", async () => {
  const f = await setup(),
    close = vi.fn(async () => {
      throw new CliError("configuration_error", "close failed")
    }),
    read = vi.fn(async () => {
      throw new CliError("not_found", "fixture cue missing")
    })
  setConfig(f.deps.configPath, "account.profile", "AliceExample")
  f.deps.connectStore = vi.fn(async () =>
    fakeConnection({ accountId: 1, close, meetingBatch: { passage: read, search: read, index: read } }),
  )
  f.deps.readBatchInput = async () => requests({ id: "p", command: ["meetings", "passage"], args: ["meeting:1/1/1/0"] })
  expect(await run(["batch", "-", "--jsonl"], f.deps)).not.toBe(0)
  expect(close).toHaveBeenCalledTimes(1)
  expect(f.output).toEqual([])
})
