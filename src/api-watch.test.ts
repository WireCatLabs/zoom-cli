import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-core"
import { fakeMeetingSource, memoryMeetingStore } from "@wirecat/cli-meetings/testing"
import { expect, it, vi } from "vitest"
import { readConfig, setConfig } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-api-watch-"))
  const controller = new AbortController()
  const output: string[] = [],
    errors: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    signal: controller.signal,
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: memoryKeyring(),
      service: "example-watch",
      fetch: async () => {
        throw new Error("unexpected grant")
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
  return { deps, controller, directory, output, errors }
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

it("validates watch options and offline policy before any account, keyring or network access", async () => {
  const { deps } = await setup()
  const connect = vi.fn(async () => {
    throw new Error("unexpected store")
  })
  deps.connectStore = connect
  const load = vi.spyOn(deps.tokens, "load")
  for (const args of [
    ["--source", "invalid"],
    ["--interval", "500ms"],
    ["--interval", "25h"],
    ["--lookback-days", "32"],
    ["--lookback-days", "1.5"],
    ["--since", "2026-02-30T10:00:00Z"],
    ["--since", "2026-10-10"],
    ["--source", "files", "--lookback-days", "0"],
    ["example", "--since", "2026-10-10T10:00:00Z"],
    ["example", "--source", "api"],
  ])
    expect(await run(["watch", ...args, "--jsonl"], deps)).toBe(2)
  setConfig(deps.configPath, "zoom.clientId", "example-client")
  setConfig(deps.configPath, "account.profile", "example-profile")
  expect(await run(["watch", "--source", "api", "--offline", "--jsonl"], deps)).toBe(3)
  expect(await run(["watch", "--source", "files", "--jsonl"], deps)).toBe(3)
  expect(await run(["watch", "--source", "api"], deps)).toBe(2)
  expect(connect).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it("resolves a configured files folder and keeps its profile/timezone bound despite configuration edits", async () => {
  const { deps, controller, directory } = await setup()
  setConfig(deps.configPath, "source", "files")
  setConfig(deps.configPath, "files.folder", directory)
  setConfig(deps.configPath, "account.profile", "example-first")
  const store = memoryMeetingStore()
  const profiles: string[] = [],
    folders: string[] = []
  deps.connectStore = async (request) => {
    profiles.push(request.profile)
    return { store, accountId: 1, close: async () => {} }
  }
  deps.readFiles = async (folder) => {
    folders.push(folder)
    return [
      { name: "2026-10-10_1530_example.vtt", content: "WEBVTT\n\n00:00.000 --> 00:01.000\nExample: bound data\n" },
    ]
  }
  deps.sleep = async () => {
    if (profiles.length === 2) controller.abort(new CliError("cancelled", "example completed"))
    else {
      setConfig(deps.configPath, "account.profile", "example-second")
      setConfig(deps.configPath, "files.folder", "example-other-folder")
      setConfig(deps.configPath, "files.timezone", "America/New_York")
      setConfig(deps.configPath, "source", "api")
    }
  }
  expect(await run(["watch", "--jsonl"], deps)).toBe(130)
  expect(profiles).toEqual(["example-first", "example-first"])
  expect(folders).toEqual([directory, directory])
  expect((await store.meetings({ accountId: 1 }))[0]?.startedAt).toBe(Date.parse("2026-10-10T15:30:00Z"))
})

it("uses shared cursor lookback to discover a late API transcript with fresh sources and pinned OAuth identity", async () => {
  const { deps, controller, output } = await setup()
  setConfig(deps.configPath, "zoom.clientId", "example-first-client")
  setConfig(deps.configPath, "account.profile", "example-first")
  deps.tokens = new TokenManager({
    ...deps.tokens.options,
    get clientId() {
      return readConfig(deps.configPath).clientId ?? ""
    },
  })
  deps.tokens.save({
    accessToken: "example-first-token",
    refreshToken: "example-refresh",
    expiresAt: Date.UTC(2040, 0, 1),
    scopes: [
      "meeting:read:list_meetings",
      "meeting:read:list_past_participants",
      "cloud_recording:read:meeting_transcript",
      "meeting:read:summary",
    ],
  })
  const store = memoryMeetingStore()
  await store.setCursor(1, "2026-10-10T00:00:00Z", 0)
  let now = Date.parse("2026-10-10T12:00:00Z"),
    cycles = 0,
    listed = 0
  deps.now = () => now
  const order: string[] = [],
    profiles: string[] = []
  deps.connectStore = async (request) => {
    profiles.push(request.profile)
    order.push("open")
    return {
      store,
      accountId: 1,
      close: async () => {
        order.push("close")
      },
    }
  }
  deps.fetch = async (input, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.headers).toMatchObject({ authorization: "Bearer example-first-token" })
    const path = new URL(String(input)).pathname
    if (path === "/v2/users/me/meetings") {
      listed++
      return response({
        meetings: [
          {
            id: 123456789,
            uuid: "example-occurrence",
            topic: "Example late transcript",
            start_time: "2026-10-09T10:00:00Z",
            type: 2,
            duration: 30,
          },
        ],
      })
    }
    if (path.endsWith("/participants")) return response({ participants: [] })
    if (path.endsWith("/transcript"))
      return cycles === 0
        ? response({ code: 3322 }, 404)
        : response({ download_url: "https://zoom.us/example-transcript" })
    if (path.endsWith("/meeting_summary")) return response({ code: 3001 }, 404)
    if (path === "/example-transcript")
      return new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nExample: Late transcript arrived\n")
    throw new Error("unexpected scripted endpoint")
  }
  deps.streamData = async (text) => {
    output.push(text)
    order.push("receipt")
    cycles++
  }
  deps.sleep = async () => {
    if (cycles === 2) controller.abort(new CliError("cancelled", "example completed"))
    else {
      now = Date.parse("2026-10-11T12:00:00Z")
      setConfig(deps.configPath, "account.profile", "example-second")
      setConfig(deps.configPath, "zoom.clientId", "example-second-client")
      setConfig(deps.configPath, "source", "files")
    }
  }
  expect(await run(["watch", "--source", "api", "--lookback-days", "2", "--jsonl"], deps)).toBe(130)
  expect(listed).toBe(2)
  expect(profiles).toEqual(["example-first", "example-first"])
  expect(order).toEqual(["open", "close", "receipt", "open", "close", "receipt"])
  expect(output.map((line) => JSON.parse(line).transcriptRows)).toEqual([0, 1])
  expect(await store.cursor(1)).toBe("2026-10-11T12:00:00.000Z")
  expect(await store.search("Late transcript", { accountId: 1 })).toHaveLength(1)
})

it("delegates an injected source without requiring a real client and never overlaps ingestion or receipt writing", async () => {
  const { deps, controller } = await setup()
  deps.store = memoryMeetingStore()
  deps.accountId = 1
  const since: string[] = []
  deps.source = fakeMeetingSource({
    meetings: async (value) => {
      since.push(value)
      return []
    },
  })
  let queued: (() => void) | undefined, release: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    queued = resolve
  })
  deps.streamData = async () => {
    queued?.()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  }
  deps.sleep = async () => {
    controller.abort(new CliError("cancelled", "example done"))
  }
  const running = run(
    ["watch", "--source", "api", "--since", "2026-10-01T00:00:00.123456+02:00", "--lookback-days", "1", "--jsonl"],
    deps,
  )
  await started
  expect(since).toEqual(["2026-09-29T22:00:00.123Z"])
  release?.()
  expect(await running).toBe(130)
  expect(since).toHaveLength(1)
})

it("closes an interrupted API cycle without advancing its cursor or issuing later reads", async () => {
  const { deps, controller, output } = await setup()
  setConfig(deps.configPath, "account.profile", "example-profile")
  const store = memoryMeetingStore()
  await store.setCursor(1, "2026-10-10T00:00:00Z", 0)
  const close = vi.fn(async () => {})
  deps.connectStore = async () => ({ store, accountId: 1, close })
  const transcript = vi.fn(async () => {
    controller.abort(new CliError("cancelled", "example interrupted"))
    return []
  })
  const chat = vi.fn(async () => null)
  deps.source = fakeMeetingSource({ transcript, chat })
  expect(await run(["watch", "--source", "api", "--jsonl"], deps)).toBe(130)
  expect(close).toHaveBeenCalledOnce()
  expect(chat).not.toHaveBeenCalled()
  expect(await store.cursor(1)).toBe("2026-10-10T00:00:00Z")
  expect(output).toEqual([])
})

it("rejects mismatched OAuth configuration before opening a store and preserves uncertain grants", async () => {
  const { deps, controller } = await setup()
  setConfig(deps.configPath, "zoom.clientId", "different-example-client")
  setConfig(deps.configPath, "account.profile", "example-profile")
  const connect = vi.fn(async () => ({ store: memoryMeetingStore(), accountId: 1, close: async () => {} }))
  deps.connectStore = connect
  expect(await run(["watch", "--source", "api", "--jsonl"], deps)).toBe(3)
  expect(connect).not.toHaveBeenCalled()
  deps.source = fakeMeetingSource({
    transcript: async () => {
      controller.abort(new CliError("cancelled", "example aborted"))
      throw new CliError("outcome_unknown", "example uncertain grant")
    },
  })
  expect(await run(["watch", "--source", "api", "--jsonl"], deps)).toBe(14)
})

it("uses an explicit initial bound until an acknowledged cursor advance, then applies cursor lookback", async () => {
  const { deps, controller } = await setup()
  const store = memoryMeetingStore()
  deps.store = store
  deps.accountId = 1
  let now = Date.parse("2026-10-10T12:00:00Z"),
    cycles = 0
  deps.now = () => now
  const since: string[] = []
  let fail = true
  deps.source = fakeMeetingSource({
    meetings: async (value) => {
      since.push(value)
      return fail ? await fakeMeetingSource().meetings(value) : []
    },
    transcript: async () => {
      throw new CliError("provider_error", "example first-cycle failure")
    },
  })
  deps.streamData = async () => {
    cycles++
  }
  deps.sleep = async () => {
    if (cycles === 3) controller.abort(new CliError("cancelled", "example done"))
    else {
      fail = false
      now = Date.parse(cycles === 1 ? "2026-10-11T12:00:00Z" : "2026-10-12T12:00:00Z")
    }
  }
  expect(
    await run(["watch", "--source", "api", "--since", "2026-01-01T00:00:00Z", "--lookback-days", "2", "--jsonl"], deps),
  ).toBe(130)
  expect(since).toEqual(["2025-12-30T00:00:00.000Z", "2025-12-30T00:00:00.000Z", "2026-10-09T12:00:00.000Z"])
  expect(await store.cursor(1)).toBe("2026-10-12T12:00:00.000Z")
})

it("does not acknowledge an uncertain or cancelled cursor write and always closes the cycle", async () => {
  const { deps, controller, output } = await setup()
  setConfig(deps.configPath, "account.profile", "example-profile")
  const store = memoryMeetingStore()
  const close = vi.fn(async () => {})
  deps.connectStore = async () => ({ store, accountId: 1, close })
  deps.source = fakeMeetingSource({ meetings: async () => [] })
  const setter = vi.spyOn(store, "setCursor").mockImplementation(async () => {
    controller.abort(new CliError("cancelled", "example cursor cancelled"))
    throw new CliError("outcome_unknown", "example uncertain cursor")
  })
  expect(await run(["watch", "--source", "api", "--since", "2026-01-01T00:00:00Z", "--jsonl"], deps)).toBe(14)
  expect(setter).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
  expect(output).toEqual([])
})
