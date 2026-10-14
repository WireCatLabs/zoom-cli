import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Writable } from "node:stream"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { expect, it, vi } from "vitest"
import { setConfig } from "./config.js"
import { writeExportFile } from "./output-file.js"
import { type ProgramDeps, run } from "./program.js"
import { emitReceipt, writeStream } from "./streaming.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const folder = await mkdtemp(join(tmpdir(), "zm-test-streaming-"))
  const controller = new AbortController()
  const output: string[] = [],
    errors: string[] = []
  const deps: ProgramDeps = {
    configPath: join(folder, "config.json"),
    signal: controller.signal,
    tokens: new TokenManager({
      clientId: "example",
      keyring: memoryKeyring(),
      service: "example",
      fetch: async () => {
        throw new Error("unexpected token request")
      },
    }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
  }
  return { deps, controller, output, errors, folder }
}
const meeting = { id: "123456789", uuid: "example-uuid", title: "Example", startedAt: null, assets: [] }
const report = { uuid: "example-uuid", manifestPath: "example.json", downloaded: [], skipped: [], unavailable: [] }

it("waits for stdout drain and settles cancellation while blocked", async () => {
  let complete: (() => void) | undefined
  const stream = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      complete = callback
    },
  })
  const controller = new AbortController()
  let finished = false
  const writing = writeStream(stream, "example", controller.signal).then(() => {
    finished = true
  })
  await Promise.resolve()
  expect(finished).toBe(false)
  complete?.()
  await writing
  expect(finished).toBe(true)
  const blocked = writeStream(stream, "second", controller.signal)
  controller.abort(new CliError("cancelled", "example cancelled"))
  await expect(blocked).rejects.toMatchObject({ code: "cancelled" })
  expect(stream.listenerCount("drain")).toBe(0)
  complete?.()
})

it("bounds each receipt and propagates stdout failure without enqueueing another receipt", async () => {
  const write = vi.fn(async () => {})
  await expect(emitReceipt("oversized", 1, write)).rejects.toMatchObject({ code: "invalid_response" })
  expect(write).not.toHaveBeenCalled()
  await emitReceipt("example", 0, write)
  expect(write).toHaveBeenCalledWith("example")
  const broken = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("example broken pipe"))
    },
  })
  await expect(writeStream(broken, "example", new AbortController().signal)).rejects.toMatchObject({
    code: "configuration_error",
  })
})

it("streams bounded archive sync receipts with consumer backpressure", async () => {
  const { deps, output } = await setup()
  setConfig(deps.configPath, "zoom.clientId", "example")
  let release: (() => void) | undefined
  let writing: (() => void) | undefined
  const queued = new Promise<void>((resolve) => {
    writing = resolve
  })
  const downloaded: string[] = []
  deps.recordings = {
    list: async () => [meeting, { ...meeting, uuid: "example-second" }],
    show: async () => meeting,
    download: async (uuid, options) => {
      expect(options?.maxBytes).toBe(1024)
      downloaded.push(uuid)
      return { ...report, uuid }
    },
  }
  deps.streamData = async (text) => {
    output.push(text)
    if (output.length === 1) {
      writing?.()
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
  }
  const pending = run(
    [
      "recordings",
      "sync",
      "--since-time",
      "2026-10-01",
      "--until-time",
      "2026-10-10",
      "--destination",
      "example",
      "--max-bytes",
      "1024",
      "--jsonl",
    ],
    deps,
  )
  await queued
  expect(downloaded).toEqual(["example-uuid"])
  release?.()
  expect(await pending).toBe(0)
  expect(downloaded).toEqual(["example-uuid", "example-second"])
  expect(output.map((text) => JSON.parse(text).meeting.uuid)).toEqual(downloaded)
})

it("keeps completed sync receipts when a later occurrence fails and rejects headless aggregate output", async () => {
  const { deps, output } = await setup()
  setConfig(deps.configPath, "zoom.clientId", "example")
  deps.recordings = {
    list: async () => [meeting, { ...meeting, uuid: "example-second" }],
    show: async () => meeting,
    download: async (uuid) => {
      if (uuid !== meeting.uuid) throw new CliError("network_error", "example failure")
      return report
    },
  }
  expect(
    await run(
      [
        "recordings",
        "sync",
        "--since-time",
        "2026-10-01",
        "--until-time",
        "2026-10-10",
        "--destination",
        "example",
        "--jsonl",
      ],
      deps,
    ),
  ).toBe(10)
  expect(output).toHaveLength(1)
  expect(JSON.parse(output[0] ?? "{}").archive.manifest_path).toBe("example.json")
  expect(
    await run(
      ["recordings", "sync", "--since-time", "2026-10-01", "--until-time", "2026-10-10", "--destination", "example"],
      deps,
    ),
  ).toBe(2)
})

it("rescans watched folders with a fresh closed account connection before each receipt", async () => {
  const { deps, controller, output, folder } = await setup()
  setConfig(deps.configPath, "account.profile", "example-profile")
  const store = memoryMeetingStore()
  const order: string[] = []
  deps.connectStore = async () => {
    order.push("open")
    return {
      store,
      accountId: 1,
      close: async () => {
        order.push("close")
      },
    }
  }
  let cycles = 0
  deps.readFiles = async () => {
    order.push("read")
    cycles++
    return []
  }
  deps.streamData = async (text) => {
    order.push("receipt")
    output.push(text)
  }
  deps.sleep = async (_ms, signal) => {
    if (cycles === 2) controller.abort(new CliError("cancelled", "example watch stopped"))
    expect(signal).toBeInstanceOf(AbortSignal)
  }
  expect(await run(["watch", "files", folder, "--interval", "1s", "--jsonl"], deps)).toBe(130)
  expect(order).toEqual(["open", "read", "close", "receipt", "open", "read", "close", "receipt"])
  expect(output).toHaveLength(2)
  expect(await run(["watch", "files", folder], { ...deps, signal: undefined })).toBe(2)
})

it("closes failed watch connections and emits no successful receipt", async () => {
  const { deps, folder, output } = await setup()
  setConfig(deps.configPath, "account.profile", "example-profile")
  const close = vi.fn(async () => {})
  deps.connectStore = async () => ({ store: memoryMeetingStore(), accountId: 0, close })
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(3)
  expect(close).toHaveBeenCalledOnce()
  expect(output).toEqual([])
  deps.connectStore = async () => ({
    store: memoryMeetingStore(),
    accountId: 1,
    close: async () => {
      throw new Error("example close failure")
    },
  })
  deps.readFiles = async () => []
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(3)
  expect(output).toEqual([])
})

it("validates watch profiles and classifies connection failures before reading files", async () => {
  const { deps, folder, output } = await setup()
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(3)
  deps.connectStore = async () => {
    throw new Error("example private database cause")
  }
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(3)
  setConfig(deps.configPath, "account.profile", "example-profile")
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(3)
  deps.connectStore = async () => {
    throw new CliError("permission_error", "example permission")
  }
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(5)
  const close = vi.fn(async () => {
    throw new Error("example close failure")
  })
  deps.connectStore = async () => ({ store: memoryMeetingStore(), accountId: 1, close })
  deps.readFiles = async () => {
    throw new CliError("validation_error", "example invalid folder")
  }
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(2)
  expect(close).toHaveBeenCalledOnce()
  expect(output).toEqual([])
})

it("rejects aggregate JSON for continuous streams and sanitizes a synchronous writable failure", async () => {
  const { deps, folder } = await setup()
  expect(await run(["watch", "files", folder, "--json"], { ...deps, outputIsTTY: true })).toBe(2)
  expect(
    await run(
      [
        "recordings",
        "sync",
        "--since-time",
        "2026-10-01",
        "--until-time",
        "2026-10-10",
        "--destination",
        folder,
        "--json",
      ],
      {
        ...deps,
        outputIsTTY: true,
      },
    ),
  ).toBe(2)
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
  vi.spyOn(stream, "write").mockImplementation(() => {
    throw new Error("example private write error")
  })
  await expect(writeStream(stream, "example", new AbortController().signal)).rejects.toMatchObject({
    code: "configuration_error",
  })
})

it("waits for accepted-write callbacks and absorbs late failures after cancellation", async () => {
  let callback: ((error?: Error | null) => void) | undefined
  const stream = new Writable({
    write(_chunk, _encoding, done) {
      callback = done
    },
  })
  let completed = false
  const pending = writeStream(stream, "example", new AbortController().signal).finally(() => {
    completed = true
  })
  await Promise.resolve()
  expect(completed).toBe(false)
  callback?.(new Error("example delayed write failure"))
  await expect(pending).rejects.toMatchObject({ code: "configuration_error" })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(stream.listenerCount("error")).toBe(0)

  const aborted = new Writable({
    write(_chunk, _encoding, done) {
      callback = done
    },
  })
  const controller = new AbortController()
  const writing = writeStream(aborted, "example", controller.signal)
  controller.abort(new CliError("cancelled", "example output stopped"))
  await expect(writing).rejects.toMatchObject({ code: "cancelled" })
  expect(aborted.listenerCount("error")).toBe(1)
  callback?.(new Error("example late pipe failure"))
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(aborted.listenerCount("error")).toBe(0)
})

it("rescans real downloaded files so corrections replace current search while preserving transcript history", async () => {
  const { deps, controller, folder } = await setup()
  const path = join(folder, "2026-10-10_1530_example-planning.vtt")
  const content = (text: string) => `WEBVTT\n\n00:00.000 --> 00:02.000\nExample: ${text}\n`
  await writeFile(path, content("Original example"))
  const store = memoryMeetingStore()
  deps.store = store
  deps.accountId = 1
  let receipts = 0
  deps.streamData = async () => {
    receipts++
  }
  deps.sleep = async () => {
    if (receipts === 1) await writeFile(path, content("Corrected example"))
    else controller.abort(new CliError("cancelled", "example watch complete"))
  }
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(130)
  expect(receipts).toBe(2)
  expect(await store.search("Original", { accountId: 1 })).toEqual([])
  expect(await store.search("Corrected", { accountId: 1 })).toHaveLength(1)
  const meetings = await store.meetings({ accountId: 1 })
  expect(meetings).toHaveLength(1)
  expect((await store.meeting(meetings[0]?.id ?? 0))?.transcripts).toHaveLength(2)
})

it("publishes usable serve/login discovery examples and forwards MCP per-tool bounds", async () => {
  const { deps, output } = await setup()
  expect(await run(["commands", "serve", "--json"], deps)).toBe(0)
  expect(JSON.parse(output.at(-1) ?? "{}").commands[0].examples).toEqual(["zm serve --mcp"])
  expect(await run(["commands", "session", "start", "--json"], deps)).toBe(0)
  expect(JSON.parse(output.at(-1) ?? "{}").commands[0].examples).toEqual(["zm session start --interactive"])
  deps.serveMcp = vi.fn(async ({ maxResultBytes }) => {
    expect(maxResultBytes).toBe(0)
  })
  expect(await run(["serve", "--mcp", "--max-output-bytes", "0"], deps)).toBe(0)
  expect(deps.serveMcp).toHaveBeenCalledOnce()
})

it("uses published summary/history/export commands and writes exact VTT without overwrite", async () => {
  const { deps, folder, output } = await setup()
  deps.store = memoryMeetingStore()
  deps.accountId = 1
  deps.writeFile = writeExportFile
  deps.readFiles = async () => [
    {
      name: "2026-10-10_1530_example-planning.vtt",
      content: "WEBVTT\n\n00:00.000 --> 00:02.000\nExample: exported words\n",
    },
  ]
  expect(await run(["meetings", "import", folder, "--json"], deps)).toBe(0)
  const meetings = await deps.store.meetings({ accountId: 1 })
  const id = String(meetings[0]?.id)
  expect(await run(["meetings", "summary", id, "--json"], deps)).toBe(0)
  expect(JSON.parse(output.at(-1) ?? "{}").items).toEqual([])
  expect(await run(["meetings", "transcript", id, "--history", "--json"], deps)).toBe(0)
  expect(JSON.parse(output.at(-1) ?? "{}").items).toHaveLength(1)
  const target = join(folder, "exported.vtt")
  expect(await run(["meetings", "export", id, "--format", "vtt", "--output", target, "--json"], deps)).toBe(0)
  const { readFile } = await import("node:fs/promises")
  expect(await readFile(target, "utf8")).toContain("exported words")
  expect(JSON.parse(output.at(-1) ?? "{}")).not.toHaveProperty("content")
  const count = output.length
  expect(await run(["meetings", "export", id, "--format", "vtt", "--output", target, "--json"], deps)).toBe(2)
  expect(output).toHaveLength(count)
})

it("flushes one completed receipt after late close cancellation through the real stream writer", async () => {
  const { deps, controller, folder, output } = await setup()
  setConfig(deps.configPath, "account.profile", "example-profile")
  const open = vi.fn(async () => ({
    store: memoryMeetingStore(),
    accountId: 1,
    close: async () => {
      controller.abort(new CliError("cancelled", "example stopped after completion"))
    },
  }))
  deps.connectStore = open
  deps.readFiles = async () => []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output.push(String(chunk))
      callback()
    },
  })
  deps.streamData = (text, signal) => writeStream(stream, text, signal)
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(130)
  expect(output).toHaveLength(1)
  expect(JSON.parse(output[0] ?? "{}").meetings).toBe(0)
  expect(open).toHaveBeenCalledOnce()
})

it("bounds late completed-receipt flushing when output remains blocked", async () => {
  const { deps, controller, folder } = await setup()
  setConfig(deps.configPath, "account.profile", "example-profile")
  const open = vi.fn(async () => ({
    store: memoryMeetingStore(),
    accountId: 1,
    close: async () => {
      controller.abort(new CliError("cancelled", "example completed then stopped"))
    },
  }))
  deps.connectStore = open
  deps.readFiles = async () => []
  let callback: (() => void) | undefined
  const stream = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, done) {
      callback = done
    },
  })
  deps.streamData = (text, signal) => writeStream(stream, text, signal)
  expect(await run(["watch", "files", folder, "--jsonl"], deps)).toBe(130)
  expect(open).toHaveBeenCalledOnce()
  expect(stream.listenerCount("drain")).toBe(0)
  callback?.()
  expect(stream.listenerCount("error")).toBe(0)
})
