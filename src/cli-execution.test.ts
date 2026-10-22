import { access, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { snakeKeys } from "@wirecat/cli-core/cli"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { describe, expect, it, vi } from "vitest"
import { readAnswer, readJsonlPage } from "../scripts/testing/answers.js"
import { fakeConnection } from "../scripts/testing/connection.js"
import { useProfile } from "../scripts/testing/profile.js"
import { profileAccountKey, readConfig, setConfig } from "./config.js"
import { writeExportFile } from "./output-file.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const response = (value: unknown) => new Response(JSON.stringify(value))
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-execution-"))
  const stdout: string[] = []
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: memoryKeyring(),
      service: "example",
      now: () => 0,
      fetch: async () =>
        response({
          access_token: "example-access",
          refresh_token: "example-refresh",
          expires_in: 3600,
          scope: "user:read:user",
        }),
    }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
    now: () => Date.UTC(2026, 9, 10),
  }
  return { deps, stdout, stderr, directory }
}
const value = (rows: string[]) => {
  const text = rows.at(-1) ?? "{}"
  const packet = JSON.parse(text)
  return "error" in packet || "commands" in packet ? packet : readAnswer(text)
}
const meeting = {
  id: "123456789",
  uuid: "example-occurrence",
  title: "Example planning",
  startedAt: "2026-10-10T15:30:00Z",
  assets: [],
}
const archive = {
  uuid: meeting.uuid,
  manifestPath: "example-manifest.json",
  downloaded: [],
  skipped: [],
  unavailable: [],
}
const catalog = () => {
  throw new Error("unexpected catalog")
}

describe("command execution controls", () => {
  it("projects values while retaining discovery identities and complete error envelopes", async () => {
    const { deps, stdout, stderr } = await setup()
    await writeFile(deps.configPath, "invalid")
    expect(await run(["--json=usage", "commands", "recordings", "download"], deps)).toBe(0)
    expect(value(stdout).commands[0]).toMatchObject({
      name: "download",
      path: ["recordings", "download"],
      effects: { remote: "read", local: "write" },
    })
    expect(value(stdout).commands[0].usage).toContain("<meeting>")
    expect(value(stdout).commands[0]).not.toHaveProperty("description")
    expect(await run(["--json=id", "commands", "not-a-resource"], deps)).toBe(2)
    expect(value(stderr)).toHaveProperty("error.code", "validation_error")
    expect(value(stderr).error.message).toContain("command path")
  })
  it("reports a usage mistake under skill as a JSON error with exit 2", async () => {
    const { deps, stdout, stderr } = await setup()
    expect(await run(["--json", "skill", "install", "--yes"], deps)).toBe(2)
    expect(value(stderr).error).toMatchObject({ code: "validation_error", message: "unknown option '--yes'" })
    expect(stdout).toEqual([])
  })
  it("bounds UTF-8 result output with no partial stdout and allows an explicit unlimited bound", async () => {
    const { deps, stdout, stderr } = await setup()
    expect(await run(["--json", "--max-output-bytes", "1", "doctor"], deps)).toBe(13)
    expect(stdout).toEqual([])
    expect(value(stderr).error.code).toBe("invalid_response")
    expect(await run(["--json=version", "--max-output-bytes", "0", "doctor"], deps)).toBe(0)
    expect(Object.keys(value(stdout))).toEqual(["version"])
  })
  it("rejects invalid and zero timeout controls before config writes or remote dispatch", async () => {
    const { deps, stdout } = await setup()
    for (const text of ["0", "0ms", "-1", "bad", "2d", "2147483648", "0.1ms"])
      expect(await run(["--timeout", text, "config", "set", "account.profile", "example"], deps)).toBe(2)
    await expect(access(deps.configPath)).rejects.toThrow()
    expect(await run(["--max-output-bytes", "-1", "doctor"], deps)).toBe(2)
    expect(stdout).toEqual([])
  })
  it("rejects offline API work before opening a store or loading credentials", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    useProfile(deps.configPath, "example")
    vi.spyOn(deps.tokens.options.keyring, "get").mockImplementation(() => {
      throw new Error("unexpected keyring")
    })
    deps.connectStore = async () => {
      throw new Error("unexpected database")
    }
    for (const args of [
      ["session", "start"],
      ["session", "status", "--check"],
      ["recordings", "list"],
      ["meetings", "sync"],
      ["remote-meetings", "create", "--title", "Example", "--type", "1", "--yes"],
    ])
      expect(await run(["--offline", ...args], deps)).toBe(3)
    expect(stdout).toEqual([])
  })
  it("waits for an in-flight store operation before closing after cancellation", async () => {
    const { deps, stdout } = await setup()
    useProfile(deps.configPath, "example")
    const controller = new AbortController()
    deps.signal = controller.signal
    let began: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      began = resolve
    })
    let release: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
      release = resolve
    })
    let closed = 0
    let settled = false
    const store = memoryMeetingStore()
    store.meetings = async () => {
      began()
      await finished
      settled = true
      return []
    }
    deps.connectStore = async () =>
      fakeConnection({
        store,
        accountId: 1,
        close: async () => {
          expect(settled).toBe(true)
          closed++
        },
      })
    const pending = run(["--json", "meetings", "list"], deps)
    await started
    controller.abort()
    await Promise.resolve()
    expect(closed).toBe(0)
    release()
    expect(await pending).toBe(130)
    expect(closed).toBe(1)
    expect(stdout).toEqual([])
  })
  it("propagates a command deadline through provider fetch and never guesses a write outcome", async () => {
    const { deps, stdout, stderr } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    let expire: () => void = () => {}
    deps.sleep = async (_ms, signal) =>
      new Promise<void>((resolve, reject) => {
        expire = resolve
        signal?.addEventListener("abort", () => reject(new Error("timer disposed")), { once: true })
      })
    let calls = 0
    deps.tokens.forProfile("example", null).save({
      accessToken: "example",
      refreshToken: "example",
      expiresAt: 3600000,
      scopes: ["meeting:write:meeting"],
    })
    deps.fetch = async (_url, init) => {
      calls++
      expire()
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("private transport reason")), { once: true }),
      )
    }
    expect(
      await run(
        ["example", "--timeout", "1s", "remote-meetings", "create", "--title", "Example", "--type", "1", "--yes"],
        deps,
      ),
    ).toBe(14)
    expect(calls).toBe(1)
    expect(stdout).toEqual([])
    expect(value(stderr).error.code).toBe("outcome_unknown")
    expect(stderr.join("")).not.toContain("private transport")
  })
  it("uses command-aware deadlines and resets prior parse flags", async () => {
    const { deps, stdout } = await setup()
    const durations: number[] = []
    deps.sleep = async (ms, signal) =>
      new Promise<void>((_resolve, reject) => {
        durations.push(ms)
        signal?.addEventListener("abort", () => reject(new Error("disposed")), { once: true })
      })
    const program = createProgram(deps)
    await program.parseAsync(["--json=version", "--timeout", "2s", "doctor"], { from: "user" })
    await program.parseAsync(["--json", "doctor"], { from: "user" })
    expect(durations).toEqual([2000, 30000])
    expect(Object.keys(value(stdout))).toContain("authentication")
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    useProfile(deps.configPath, "example-profile")
    deps.recordings = { list: async () => [], show: async () => meeting, download: async () => archive, catalog }
    expect(await run(["recordings", "download", "example", "--output-dir", "invented"], deps)).toBe(0)
    expect(durations.at(-1)).toBe(3600000)
    deps.openBrowser = async (url) => {
      const state = new URL(url).searchParams.get("state") ?? ""
      await fetch(
        `http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, code: "example-code" })}`,
      )
    }
    expect(await run(["session", "start"], deps)).toBe(0)
    expect(durations.at(-1)).toBe(300000)
  })
})

describe("login without a terminal", () => {
  it("answers JSON and prints the URL an agent passes on, even with --quiet", async () => {
    const { deps, stdout, stderr } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    deps.outputIsTTY = false
    deps.openBrowser = async (url) => {
      const state = new URL(url).searchParams.get("state") ?? ""
      await fetch(
        `http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, code: "example-code" })}`,
      )
    }
    expect(await run(["example", "--json", "--quiet", "session", "start"], deps)).toBe(0)
    expect(stderr.join("")).toMatch(/^Open this URL to approve Zoom login:\nhttps:\/\/\S+\n$/)
    expect(JSON.parse(stdout.join(""))).toMatchObject({ item: { logged_in: true, profile: "example" } })
    expect(readConfig(deps.configPath).profiles).toEqual(["example"])
  })
})

describe("archive and explicit remote command wiring", () => {
  it.each([
    ["Asia/Vladivostok", "2026-10-21T23:30:00Z", "2026-09-22", "2026-10-22"],
    ["America/Los_Angeles", "2026-10-22T03:00:00Z", "2026-09-21", "2026-10-21"],
  ])("ends the default recordings list on today in %s, and names that zone", async (zone, now, from, to) => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    const list = vi.fn(async () => [])
    deps.recordings = { list, show: vi.fn(), download: vi.fn(), catalog }
    deps.now = () => Date.parse(now)
    expect(await run(["--json", "recordings", "list", "--timezone", zone], deps)).toBe(0)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ from, to }))
    expect(JSON.parse(stdout.join("")).meta.timezone).toBe(zone)
  })
  it("takes today from the computer's zone when no --timezone is given", async () => {
    const saved = process.env.TZ
    process.env.TZ = "Asia/Vladivostok"
    try {
      const { deps } = await setup()
      setConfig(deps.configPath, "zoom.clientId", "example-client")
      const list = vi.fn(async () => [])
      deps.recordings = { list, show: vi.fn(), download: vi.fn(), catalog }
      deps.now = () => Date.parse("2026-10-21T23:30:00Z")
      expect(await run(["--json", "recordings", "list"], deps)).toBe(0)
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ to: "2026-10-22" }))
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })
  it("says text times are UTC, and only when text shows one", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    const list = vi.fn(async () => [meeting])
    deps.recordings = { list, show: vi.fn(), download: vi.fn(), catalog }
    deps.outputIsTTY = true
    expect(await run(["recordings", "list", "--timezone", "UTC"], deps)).toBe(0)
    expect(stdout.join("")).toContain("2026-10-10T15:30:00Z")
    expect(stdout.join("")).toMatch(/times in UTC\n$/)
    stdout.length = 0
    list.mockResolvedValueOnce([])
    expect(await run(["recordings", "list", "--timezone", "UTC"], deps)).toBe(0)
    expect(stdout.join("")).not.toContain("times in UTC")
    stdout.length = 0
    deps.outputIsTTY = false
    expect(await run(["recordings", "list", "--timezone", "UTC"], deps)).toBe(0)
    expect(stdout.join("")).not.toContain("times in UTC")
  })
  it("refuses an unknown --timezone before listing", async () => {
    const { deps, stderr } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    const list = vi.fn(async () => [])
    deps.recordings = { list, show: vi.fn(), download: vi.fn(), catalog }
    expect(await run(["--json", "recordings", "list", "--timezone", "Mars/Example"], deps)).toBe(2)
    expect(value(stderr).error.code).toBe("validation_error")
    expect(list).not.toHaveBeenCalled()
  })
  it("lists/shows/downloads recording metadata with explicit options and no database", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    useProfile(deps.configPath, "example-profile")
    const list = vi.fn(async () => [meeting])
    const show = vi.fn(async () => meeting)
    const download = vi.fn(async () => archive)
    deps.recordings = { list, show, download, catalog }
    deps.connectStore = async () => {
      throw new Error("unexpected database")
    }
    expect(await run(["--json", "recordings", "list", "--timezone", "Europe/Madrid"], deps)).toBe(0)
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-09-10", to: "2026-10-10", signal: expect.any(AbortSignal) }),
    )
    expect(value(stdout).items).toEqual([snakeKeys(meeting)])
    expect(
      await run(["--jsonl", "recordings", "list", "--since-time", "2026-10-01", "--until-time", "2026-10-10"], deps),
    ).toBe(0)
    expect(readJsonlPage(stdout.at(-1) ?? "{}").items[0].uuid).toBe(meeting.uuid)
    expect(await run(["--json", "recordings", "show", "example-occurrence"], deps)).toBe(0)
    expect(show).toHaveBeenCalledWith(
      "example-occurrence",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(
      await run(
        [
          "--json",
          "recordings",
          "download",
          "example-occurrence",
          "--output-dir",
          "invented",
          "--file-ids",
          "first, second",
          "--max-bytes",
          "100",
        ],
        deps,
      ),
    ).toBe(0)
    expect(download).toHaveBeenCalledWith(
      "example-occurrence",
      expect.objectContaining({
        destination: "invented",
        fileIds: ["first", "second"],
        maxBytes: 100,
        account: profileAccountKey("example-profile"),
      }),
    )
    expect(await run(["recordings", "download", "example", "--output-dir", "invented", "--max-bytes", "0"], deps)).toBe(
      2,
    )
  })
  it("inspects and verifies local archives without a client, token or DB and only explicitly repairs", async () => {
    const { deps, stdout } = await setup()
    vi.spyOn(deps.tokens.options.keyring, "get").mockImplementation(() => {
      throw new Error("unexpected keyring")
    })
    const recover = vi.fn(async () => ({ locks: [], removed: [] }))
    const inspect = vi.fn(async () => [])
    const verify = vi.fn(async () => [])
    const locks = vi.fn(async () => [])
    deps.archive = { inspect, verify, locks, recover }
    for (const action of ["show", "check", "locks"])
      expect(await run(["--offline", "--json", "recordings", "archive", action, "invented"], deps)).toBe(0)
    expect(value(stdout).items).toEqual([])
    expect(await run(["recordings", "archive", "recover", "invented"], deps)).toBe(0)
    expect(recover).toHaveBeenLastCalledWith("invented", expect.objectContaining({ apply: false }))
    expect(await run(["recordings", "archive", "recover", "invented", "--yes"], deps)).toBe(0)
    expect(recover).toHaveBeenLastCalledWith("invented", expect.objectContaining({ apply: true }))
    expect(await run(["recordings", "archive", "recover", "invented", "--yes", "--dry-run"], deps)).toBe(0)
    expect(recover).toHaveBeenLastCalledWith("invented", expect.objectContaining({ apply: false }))
  })
  it("previews remote mutations without login, and --dry-run wins over --yes", async () => {
    const { deps, stdout } = await setup()
    useProfile(deps.configPath)
    vi.spyOn(deps.tokens.options.keyring, "get").mockImplementation(() => {
      throw new Error("unexpected keyring")
    })
    expect(
      await run(
        [
          "--offline",
          "--json",
          "remote-meetings",
          "create",
          "--title",
          "Example planning",
          "--start-time",
          "2026-10-10T15:30:00Z",
          "--duration-minutes",
          "30",
          "--timezone",
          "UTC",
          "--agenda",
          "Example agenda",
          "--dry-run",
        ],
        deps,
      ),
    ).toBe(0)
    expect(value(stdout)).toMatchObject({
      action: "create",
      applied: false,
      request: { method: "POST", body: { topic: "Example planning", duration: 30 } },
    })
    expect(
      await run(
        [
          "--json",
          "remote-meetings",
          "update",
          "123456789",
          "--title",
          "Example",
          "--start-time",
          "2026-10-10T15:30:00Z",
          "--duration-minutes",
          "45",
          "--timezone",
          "UTC",
          "--agenda",
          "Invented agenda",
          "--type",
          "2",
          "--yes",
          "--dry-run",
        ],
        deps,
      ),
    ).toBe(0)
    expect(value(stdout)).toMatchObject({
      action: "update",
      applied: false,
      request: {
        body: {
          start_time: "2026-10-10T15:30:00.000Z",
          duration: 45,
          timezone: "UTC",
          agenda: "Invented agenda",
          type: 2,
        },
      },
    })
    expect(
      await run(
        [
          "--json",
          "remote-meetings",
          "cancel",
          "123456789",
          "--occurrence-id",
          "example-occurrence",
          "--yes",
          "--dry-run",
        ],
        deps,
      ),
    ).toBe(0)
    expect(value(stdout)).toMatchObject({
      action: "cancel",
      applied: false,
      request: { path: "/meetings/123456789?occurrence_id=example-occurrence" },
    })
  })
  it("dispatches explicit mutations once and keeps remote reads separate from stored reads", async () => {
    const { deps, stdout } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    const calls: string[] = []
    deps.remoteMeetings = {
      list: async () => {
        calls.push("list")
        return []
      },
      show: async () => {
        calls.push("show")
        return { ...meeting, type: 2, durationMinutes: 30, timezone: "UTC", agenda: null, joinUrl: null }
      },
      invitation: async () => {
        calls.push("invitation")
        return { id: "123456789", invitation: "Example invitation" }
      },
      create: async (_change, options) => {
        expect(options?.apply).toBe(true)
        calls.push("create")
        return { action: "create", applied: true, request: { method: "POST", path: "/users/me/meetings" } }
      },
      update: async () => {
        calls.push("update")
        return { action: "update", applied: true, request: { method: "PATCH", path: "/meetings/123456789" } }
      },
      cancel: async () => {
        calls.push("cancel")
        return { action: "cancel", applied: true, request: { method: "DELETE", path: "/meetings/123456789" } }
      },
    }
    for (const args of [
      ["list"],
      ["show", "123456789"],
      ["invitation", "123456789"],
      ["create", "--title", "Example", "--type", "1", "--yes"],
      ["update", "123456789", "--title", "Example", "--yes"],
      ["cancel", "123456789", "--yes"],
    ])
      expect(await run(["--json", "remote-meetings", ...args], deps)).toBe(0)
    expect(calls).toEqual(["list", "show", "invitation", "create", "update", "cancel"])
    expect(value(stdout).applied).toBe(true)
  })
})

it("shares token refresh across scoped managers and preserves grant rotation", async () => {
  const { deps } = await setup()
  let calls = 0
  const tokens = new TokenManager({
    ...deps.tokens.options,
    fetch: async () => {
      calls++
      await Promise.resolve()
      return response({ access_token: "new-example", refresh_token: "rotated-example", expires_in: 3600 })
    },
  })
  tokens.save({ accessToken: "old-example", refreshToken: "old-refresh", expiresAt: 0, scopes: ["example:read"] })
  const first = tokens.withSignal(new AbortController().signal)
  const second = tokens.withSignal(new AbortController().signal)
  const [a, b] = await Promise.all([first.tokens(), second.tokens()])
  expect(calls).toBe(1)
  expect(a).toEqual(b)
  expect(a.refreshToken).toBe("rotated-example")
})

it("atomically exports without overwriting or following an existing destination symlink", async () => {
  const { directory } = await setup()
  const target = join(directory, "example.md")
  await writeExportFile(target, "Example content\n")
  expect(await readFile(target, "utf8")).toBe("Example content\n")
  await expect(writeExportFile(target, "Replacement")).rejects.toMatchObject({ code: "validation_error" })
  expect(await readFile(target, "utf8")).toBe("Example content\n")
  const { symlink } = await import("node:fs/promises")
  const alias = join(directory, "alias.md")
  await symlink(target, alias)
  await expect(writeExportFile(alias, "Replacement")).rejects.toMatchObject({ code: "validation_error" })
  const controller = new AbortController()
  controller.abort(new CliError("cancelled", "example cancellation"))
  await expect(
    writeExportFile(join(directory, "cancelled.md"), "Example", { signal: controller.signal }),
  ).rejects.toMatchObject({ code: "cancelled" })
  await expect(access(join(directory, "cancelled.md"))).rejects.toThrow()
  await expect(writeExportFile(join(directory, "missing", "example.md"), "Example")).rejects.toMatchObject({
    code: "configuration_error",
  })
})

it("cancels browser approval and closes the local callback listener without exchanging a grant", async () => {
  const { deps } = await setup()
  const { login } = await import("./login.js")
  const controller = new AbortController()
  let port = 0
  const exchange = vi.spyOn(deps.tokens, "exchange")
  await expect(
    login({
      tokens: deps.tokens,
      signal: controller.signal,
      openBrowser: async (url) => {
        port = Number(new URL(url).searchParams.get("state")?.split(".")[0])
        controller.abort(new CliError("cancelled", "example approval cancelled"))
      },
    }),
  ).rejects.toMatchObject({ code: "cancelled" })
  expect(exchange).not.toHaveBeenCalled()
  await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow()
})

it("shows and installs the packaged skill through the CLI using an isolated home", async () => {
  const { deps, stdout, stderr, directory } = await setup()
  deps.env = { HOME: directory }
  await writeFile(deps.configPath, "invalid")
  expect(await run(["skill", "show", "--json=name,content"], deps)).toBe(0)
  expect(value(stdout)).toMatchObject({ name: "zoom-cli", content: expect.stringContaining("recordings") })
  expect(await run(["skill", "show"], deps)).toBe(0)
  expect(stdout.at(-1)).toContain("name: zoom-cli")
  expect(await run(["skill", "install", "--for", "agents", "--json", "--quiet"], deps)).toBe(0)
  const target = join(directory, ".agents", "skills", "zoom-cli", "SKILL.md")
  expect(value(stdout).written).toEqual([target])
  expect(await readFile(target, "utf8")).toContain("version:")
  expect(stderr).toEqual([])
})

it("starts MCP without touching configuration or the meeting store and preserves protocol framing", async () => {
  const { deps, stdout, stderr } = await setup()
  await writeFile(deps.configPath, "invalid")
  deps.connectStore = vi.fn(async () => {
    throw new Error("unexpected store")
  })
  deps.serveMcp = vi.fn(async ({ signal }) => {
    expect(signal.aborted).toBe(false)
  })
  expect(await run(["example", "serve", "--mcp"], deps)).toBe(0)
  expect(deps.serveMcp).toHaveBeenCalledWith(expect.objectContaining({ profile: "example" }))
  expect(deps.connectStore).not.toHaveBeenCalled()
  expect(stdout).toEqual([])
  expect(stderr).toEqual([])
  expect(await run(["example", "serve", "--mcp", "--json"], deps)).toBe(2)
  expect(deps.serveMcp).toHaveBeenCalledOnce()
  delete deps.serveMcp
  expect(await run(["example", "serve", "--mcp"], deps)).toBe(3)
})

it("classifies dispatched token failures as uncertain while preflight cancellation never dispatches", async () => {
  const { deps } = await setup()
  for (const code of ["network_error", "timeout", "cancelled"] as const) {
    const fetcher = vi.fn(async () => {
      throw new CliError(code, "example private grant failure")
    })
    const tokens = new TokenManager({ ...deps.tokens.options, fetch: fetcher })
    await expect(tokens.exchange({})).rejects.toMatchObject({
      code: "outcome_unknown",
      message: expect.stringContaining("session start again"),
    })
    expect(fetcher).toHaveBeenCalledOnce()
  }
  const controller = new AbortController()
  controller.abort(new CliError("cancelled", "example preflight cancellation"))
  const fetcher = vi.fn(deps.tokens.options.fetch)
  const tokens = new TokenManager({ ...deps.tokens.options, fetch: fetcher, signal: controller.signal })
  await expect(tokens.exchange({})).rejects.toMatchObject({ code: "cancelled" })
  expect(fetcher).not.toHaveBeenCalled()
})

it("keeps token grants bound to the client sent and separates refresh singleflight by client", async () => {
  const { deps } = await setup()
  let client = "example-first-client"
  const keyring = memoryKeyring()
  const requests: string[] = []
  const tokens = new TokenManager({
    ...deps.tokens.options,
    keyring,
    get clientId() {
      return client
    },
    fetch: async (_url, init) => {
      requests.push(new URLSearchParams(String(init?.body)).get("client_id") ?? "")
      client = "example-second-client"
      await Promise.resolve()
      return response({ access_token: "example-new", refresh_token: "example-refresh", expires_in: 60 })
    },
  })
  await tokens.exchange({})
  expect(tokens.load("example-first-client")).not.toBeNull()
  expect(tokens.load("example-second-client")).toBeNull()
  client = "example-first-client"
  const first = tokens.withSignal()
  expect(first.options.clientId).toBe("example-first-client")
  client = "example-second-client"
  expect(first.options.clientId).toBe("example-first-client")
  const second = tokens.withSignal()
  const expired = { accessToken: "example-old", refreshToken: "example-old-refresh", expiresAt: 0, scopes: [] }
  tokens.save(expired, "example-first-client")
  tokens.save(expired, "example-second-client")
  await Promise.all([first.tokens(), second.tokens()])
  expect(requests).toEqual(["example-first-client", "example-first-client", "example-second-client"])
})
