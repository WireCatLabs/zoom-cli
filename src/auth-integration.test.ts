import { mkdtemp, writeFile } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { describe, expect, it } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { fakeConnection } from "../scripts/testing/connection.js"
import { setConfig } from "./config.js"
import { login } from "./login.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const reply = (body: unknown) => new Response(JSON.stringify(body))
const manager = (
  fetcher: typeof fetch = async () =>
    reply({ access_token: "example-access", refresh_token: "example-refresh", expires_in: 60, scope: "example:read" }),
) =>
  new TokenManager({
    clientId: "example-client",
    keyring: memoryKeyring(),
    service: "example",
    fetch: fetcher,
    now: () => 0,
  })
const callback = (url: string, params: Record<string, string>) => {
  const state = new URL(url).searchParams.get("state") ?? ""
  return `http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, ...params })}`
}

describe("authentication termination", () => {
  it("fails promptly when a browser cannot launch and paste is unavailable", async () => {
    let url = ""
    await expect(
      login({
        tokens: manager(),
        timeoutMs: 1000,
        showUrl: (value) => {
          url = value
        },
        openBrowser: async () => {
          throw new Error("private launcher detail")
        },
      }),
    ).rejects.toMatchObject({ code: "configuration_error", message: expect.stringMatching(/--browser/) })
    await expect(fetch(callback(url, { code: "example-code" }))).rejects.toThrow()
  })
  it("accepts query paste and cancels the paste prompt before exchanging", async () => {
    let url = ""
    let signal: AbortSignal | undefined
    const tokens = manager(async () => {
      expect(signal?.aborted).toBe(true)
      return reply({ access_token: "example-access", refresh_token: "example-refresh", expires_in: 60 })
    })
    expect(
      await login({
        tokens,
        showUrl: (value) => {
          url = value
        },
        openBrowser: async () => {},
        readPaste: async (value) => {
          signal = value
          return `code=example-code&state=${new URL(url).searchParams.get("state")}`
        },
      }),
    ).toEqual({ loggedIn: true, scopes: [] })
  })
  it("closes the listener after paste cancellation or malformed paste", async () => {
    for (const readPaste of [
      async () => {
        throw new Error("example cancellation")
      },
      async () => "malformed",
    ]) {
      let url = ""
      await expect(
        login({
          tokens: manager(),
          showUrl: (value) => {
            url = value
          },
          openBrowser: async () => {},
          readPaste,
        }),
      ).rejects.toThrow()
      await expect(fetch(callback(url, { code: "example-code" }))).rejects.toThrow()
    }
  })
  it("keeps invalid callbacks pending, uses the first valid code, and closes stalled connections on exchange failure", async () => {
    let url = ""
    let socket: ReturnType<typeof connect> | undefined
    let closed: Promise<void> | undefined
    const tokens = manager(async (_url, init) => {
      expect(new URLSearchParams(String(init?.body)).get("code")).toBe("first-example")
      return new Response("example", { status: 401 })
    })
    await expect(
      login({
        tokens,
        openBrowser: async (value) => {
          url = value
          const state = new URL(value).searchParams.get("state") ?? ""
          const port = Number(state.split(".")[0])
          socket = connect(port, "127.0.0.1")
          closed = new Promise<void>((resolve) => socket?.once("close", () => resolve()))
          await new Promise<void>((resolve) => socket?.once("connect", resolve))
          expect((await fetch(`http://127.0.0.1:${port}/callback?code=example`)).status).toBe(400)
          await Promise.all([
            fetch(callback(value, { code: "first-example" })),
            fetch(callback(value, { code: "second-example" })).catch(() => {}),
          ])
        },
      }),
    ).rejects.toThrow(/HTTP 401/)
    await closed
    expect(socket?.destroyed).toBe(true)
    await expect(fetch(callback(url, {}))).rejects.toThrow()
  })
  it("rejects matching callbacks without a code and closes stalled connections on timeout", async () => {
    await expect(
      login({
        tokens: manager(),
        openBrowser: async (url) => {
          await fetch(callback(url, {}))
        },
      }),
    ).rejects.toThrow(/not approved/)
    let closed: Promise<void> | undefined
    await expect(
      login({
        tokens: manager(),
        timeoutMs: 40,
        openBrowser: async (url) => {
          const port = Number(new URL(url).searchParams.get("state")?.split(".")[0])
          const socket = connect(port, "127.0.0.1")
          closed = new Promise<void>((resolve) => socket.once("close", () => resolve()))
          await new Promise<void>((resolve) => socket.once("connect", resolve))
        },
      }),
    ).rejects.toThrow(/timed out/)
    await closed
  })
})

describe("token validation and refresh recovery", () => {
  it("sanitizes invalid JSON and transport failures without retrying token exchange", async () => {
    let calls = 0
    const tokens = manager(async () => {
      calls++
      throw new Error("example-private-transport")
    })
    await expect(tokens.exchange({})).rejects.toMatchObject({
      code: "outcome_unknown",
      message: "Zoom token exchange did not finish; run zm session start again before retrying",
    })
    expect(calls).toBe(1)
    await expect(manager(async () => new Response("invalid JSON")).exchange({})).rejects.toMatchObject({
      code: "outcome_unknown",
    })
    for (const extra of [{ scope: [] }, { refresh_token: 1 }, { expires_in: Number.MAX_VALUE }])
      await expect(
        manager(async () =>
          reply({ access_token: "example", refresh_token: "example", expires_in: 60, ...extra }),
        ).exchange({}),
      ).rejects.toMatchObject({ code: "outcome_unknown" })
  })
  it("refreshes at the boundary, retries a later command after failure, and preserves rotation", async () => {
    let calls = 0
    const tokens = manager(async (_url, init) => {
      calls++
      expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe("example-old-refresh")
      if (calls === 1) return new Response("", { status: 500 })
      return reply({
        access_token: "example-new-access",
        refresh_token: "example-new-refresh",
        expires_in: 60,
        scope: "example:new",
      })
    })
    tokens.save({
      accessToken: "example-old-access",
      refreshToken: "example-old-refresh",
      expiresAt: 30000,
      scopes: ["example:old"],
    })
    const results = await Promise.allSettled([tokens.tokens(), tokens.tokens()])
    expect(results.every((value) => value.status === "rejected")).toBe(true)
    expect(calls).toBe(1)
    expect(await tokens.tokens()).toMatchObject({ refreshToken: "example-new-refresh", scopes: ["example:new"] })
    expect(calls).toBe(2)
    expect((await tokens.tokens()).accessToken).toBe("example-new-access")
    expect(calls).toBe(2)
  })
})

const setup = async () => {
  const configPath = join(await mkdtemp(join(tmpdir(), "zm-test-auth-")), "config.json")
  const stdout: string[] = []
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath,
    tokens: manager(async () => {
      throw new Error("unexpected token access")
    }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
  }
  return { deps, stdout, stderr }
}

describe("CLI configuration isolation", () => {
  it("shows help and version even when config is corrupt without opening tokens or a store", async () => {
    const { deps, stdout, stderr } = await setup()
    await writeFile(deps.configPath, "invalid")
    expect(await run(["--help"], deps)).toBe(0)
    expect(await run(["--version"], deps)).toBe(0)
    expect(stdout.join("")).toContain("Zoom meeting")
    expect(stderr).toEqual([])
    expect(await run(["config", "show"], deps)).toBe(3)
  })
  it("rejects whitespace client ids, conflicts and disabled input before side effects", async () => {
    const { deps, stdout, stderr } = await setup()
    expect(await run(["config", "set", "zoom.clientId", "example client"], deps)).toBe(2)
    expect(stdout).toEqual([])
    expect(stderr).toHaveLength(1)
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    expect(await run(["--json", "--jsonl", "config", "show"], deps)).toBe(2)
    expect(await run(["--no-input", "session", "start"], deps)).toBe(3)
  })
  it("reports browser and token exchange failures with their structured exit codes", async () => {
    const { deps, stderr } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    expect(await run(["session", "start"], deps)).toBe(3)
    expect(JSON.parse(stderr.at(-1) ?? "{}").error.code).toBe("configuration_error")
    deps.openBrowser = async (url) => {
      await fetch(callback(url, { code: "example-code" }))
    }
    expect(await run(["session", "start"], deps)).toBe(14)
    expect(JSON.parse(stderr.at(-1) ?? "{}").error.code).toBe("outcome_unknown")
  })
  it("delegates all configured file-source parts without changing the source port", async () => {
    const { deps } = await setup()
    deps.store = memoryMeetingStore()
    deps.accountId = 1
    deps.readFiles = async () => [
      {
        name: "2026-10-10_1530_example.vtt",
        content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Example\n",
      },
    ]
    setConfig(deps.configPath, "source", "files")
    setConfig(deps.configPath, "files.folder", "example")
    expect(await run(["meetings", "sync", "--since-time", "2026-10-01"], deps)).toBe(0)
    expect(await deps.store.meetings()).toHaveLength(1)
  })
})

it("constructs the API source lazily and respects an injected source", async () => {
  const { deps } = await setup()
  deps.store = memoryMeetingStore()
  deps.accountId = 1
  deps.tokens.save({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: 3600000,
    scopes: ["meeting:read:list_meetings"],
  })
  deps.fetch = async () => reply({ meetings: [] })
  expect(await run(["meetings", "sync", "--since-time", "2026-10-01"], deps)).toBe(0)
  const { FilesSource } = await import("./files.js")
  deps.source = new FilesSource([])
  expect(await run(["meetings", "sync", "--since-time", "2026-10-01"], deps)).toBe(0)
})

it("preflights every normalized import key before saving and deduplicates identical aliases", async () => {
  const { deps, stdout, stderr } = await setup()
  deps.store = memoryMeetingStore()
  deps.accountId = 1
  const content = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Example\n"
  const files = [
    { name: "2026-10-10_1530_café.vtt", content },
    { name: "2026-10-10_1530_cafe\u0301.vtt", content: content.replace("Example\n", "Different\n") },
  ]
  deps.readFiles = async () => files
  expect(await run(["--json", "meetings", "import", "example-folder"], deps)).toBe(2)
  expect(await deps.store.meetings()).toEqual([])
  expect(stdout).toEqual([])
  expect(stderr).toHaveLength(1)
  expect(JSON.parse(stderr[0] ?? "{}").error.code).toBe("validation_error")
  files[1] = { name: "2026-10-10_1530_cafe\u0301.vtt", content }
  expect(await run(["--json", "meetings", "import", "example-folder"], deps)).toBe(0)
  expect(readAnswer(stdout[0] ?? "{}")).toMatchObject({ meetings: 1 })
  expect(await deps.store.meetings()).toHaveLength(1)
})

it("connects lazily once with read intent and closes direct program parsing", async () => {
  const { createProgram } = await import("./program.js")
  const { deps, stdout } = await setup()
  setConfig(deps.configPath, "account.profile", "example-work")
  let opened = 0
  let closed = 0
  deps.connectStore = async (request) => {
    opened++
    expect(request).toEqual({ profile: "example-work", externalId: "zm-profile:example-work", intent: "read" })
    return fakeConnection({
      store: memoryMeetingStore(),
      accountId: 1,
      close: async () => {
        closed++
      },
    })
  }
  const program = createProgram(deps)
  await program.parseAsync(["--json", "meetings", "list"], { from: "user" })
  expect(opened).toBe(1)
  expect(closed).toBe(1)
  expect(readAnswer(stdout[0] ?? "{}").items).toEqual([])
  await program.parseAsync(["--json", "meetings", "list"], { from: "user" })
  expect(opened).toBe(2)
  expect(closed).toBe(2)
})

it("never connects for help, version, config, parser failures or login", async () => {
  const { deps } = await setup()
  deps.connectStore = async () => {
    throw new Error("unexpected store access")
  }
  for (const args of [
    ["--help"],
    ["--version"],
    ["config", "show"],
    ["config", "set", "account.profile", "example"],
    ["unknown-command"],
    ["--no-input", "session", "start"],
  ])
    expect(await run(args, deps)).toBe(args[0] === "unknown-command" ? 2 : args.includes("start") ? 3 : 0)
})

it("requires an explicit local profile before connecting and a valid account before fetching", async () => {
  const { deps, stderr } = await setup()
  let opens = 0
  let closes = 0
  deps.connectStore = async () => {
    opens++
    return fakeConnection({
      store: memoryMeetingStore(),
      accountId: 0,
      close: async () => {
        closes++
      },
    })
  }
  expect(await run(["meetings", "sync", "--since-time", "2026-10-01"], deps)).toBe(3)
  expect(opens).toBe(0)
  expect(JSON.parse(stderr.at(-1) ?? "{}").error.message).toContain("account.profile")
  setConfig(deps.configPath, "account.profile", "example")
  expect(await run(["meetings", "sync", "--since-time", "2026-10-01"], deps)).toBe(3)
  expect(opens).toBe(1)
  expect(closes).toBe(1)
  deps.store = memoryMeetingStore()
  expect(await run(["meetings", "list"], deps)).toBe(3)
  expect(opens).toBe(1)
})

it("uses the same selected local account for file import and API pull", async () => {
  const { deps } = await setup()
  setConfig(deps.configPath, "account.profile", "example")
  const store = memoryMeetingStore()
  let opens = 0
  let closes = 0
  deps.connectStore = async (request) => {
    expect(request).toEqual({ profile: "example", externalId: "zm-profile:example", intent: "ingestion" })
    opens++
    return fakeConnection({
      store,
      accountId: 2,
      close: async () => {
        closes++
      },
    })
  }
  deps.readFiles = async () => [
    {
      name: "2026-10-10_1530_example.vtt",
      content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Example\n",
    },
  ]
  expect(await run(["meetings", "import", "example-folder"], deps)).toBe(0)
  expect((await store.meetings())[0]?.accountId).toBe(2)
  deps.tokens.save({
    accessToken: "example",
    refreshToken: "example",
    expiresAt: 3600000,
    scopes: ["meeting:read:list_meetings"],
  })
  deps.fetch = async () => reply({ meetings: [] })
  expect(await run(["meetings", "sync", "--since-time", "2026-10-01"], deps)).toBe(0)
  expect(opens).toBe(2)
  expect(closes).toBe(2)
})

it("closes after command failures and preserves the primary error if close also fails", async () => {
  const { deps, stderr, stdout } = await setup()
  setConfig(deps.configPath, "account.profile", "example")
  let closes = 0
  deps.connectStore = async () =>
    fakeConnection({
      store: memoryMeetingStore(),
      accountId: 1,
      close: async () => {
        closes++
        throw new Error("private close detail")
      },
    })
  expect(await run(["meetings", "show", "999"], deps)).toBe(6)
  expect(stderr).toHaveLength(1)
  expect(JSON.parse(stderr[0] ?? "{}").error.code).toBe("not_found")
  expect(closes).toBe(1)
  expect(await run(["meetings", "list"], deps)).toBe(3)
  expect(closes).toBe(2)
  expect(stdout).toEqual([])
  expect(JSON.parse(stderr.at(-1) ?? "{}").error.message).toBe("could not close the shared meeting store")
})

it("closes after source and rejected-save errors and sanitizes connector failures", async () => {
  const { deps, stderr, stdout } = await setup()
  const { fakeMeetingSource } = await import("@wirecat/cli-core/meetings/testing")
  setConfig(deps.configPath, "account.profile", "example")
  let closes = 0
  const store = memoryMeetingStore()
  deps.connectStore = async () =>
    fakeConnection({
      store,
      accountId: 1,
      close: async () => {
        closes++
      },
    })
  deps.source = fakeMeetingSource({
    meetings: async () => {
      throw new Error("example source failure")
    },
  })
  expect(await run(["meetings", "sync", "--since-time", "2026-10-01"], deps)).toBe(1)
  expect(closes).toBe(1)
  deps.readFiles = async () => [{ name: "2026-10-10_1530_example.vtt", content: "WEBVTT\n" }]
  store.saveMeeting = async () => {
    throw new Error("example rejected save")
  }
  expect(await run(["meetings", "import", "example-folder"], deps)).toBe(0)
  expect(readAnswer(stdout.at(-1) ?? "{}").warnings).toHaveLength(1)
  expect(closes).toBe(2)
  deps.connectStore = async () => {
    throw new Error("private database path")
  }
  expect(await run(["meetings", "list"], deps)).toBe(3)
  expect(JSON.parse(stderr.at(-1) ?? "{}").error.message).toBe("could not open the shared meeting store")
  deps.connectStore = async () => {
    throw new CliError("configuration_error", "selected profile was not registered")
  }
  expect(await run(["meetings", "list"], deps)).toBe(3)
  expect(JSON.parse(stderr.at(-1) ?? "{}").error.message).toBe("selected profile was not registered")
})

it("reads older valid configuration and validates optional local profile labels", async () => {
  const { readConfig, profileAccountKey } = await import("./config.js")
  const { deps } = await setup()
  await writeFile(
    deps.configPath,
    JSON.stringify({ clientId: "example-client", source: "api", filesFolder: null, filesTimezone: "UTC" }),
  )
  expect(readConfig(deps.configPath).accountProfile).toBeNull()
  setConfig(deps.configPath, "account.profile", "Example-work_1.2")
  expect(readConfig(deps.configPath).accountProfile).toBe("Example-work_1.2")
  expect(profileAccountKey("Example-work_1.2")).toBe("zm-profile:Example-work_1.2")
  for (const value of ["", "has space", "../example", "-example", "a".repeat(65)])
    expect(() => setConfig(deps.configPath, "account.profile", value)).toThrow(/profile/)
  await writeFile(
    deps.configPath,
    JSON.stringify({
      clientId: "example-client",
      source: "api",
      filesFolder: null,
      filesTimezone: "UTC",
      accountProfile: [],
    }),
  )
  expect(() => readConfig(deps.configPath)).toThrow(/invalid/)
})

it("refreshes profile and source configuration between sequential direct parses", async () => {
  const { createProgram } = await import("./program.js")
  const { deps } = await setup()
  const profiles: string[] = []
  deps.connectStore = async (request) => {
    profiles.push(request.profile)
    return fakeConnection({ store: memoryMeetingStore(), accountId: 1, close: async () => {} })
  }
  const program = createProgram(deps)
  await program.parseAsync(["config", "set", "account.profile", "first-example"], { from: "user" })
  await program.parseAsync(["meetings", "list"], { from: "user" })
  await program.parseAsync(["config", "set", "account.profile", "second-example"], { from: "user" })
  await program.parseAsync(["meetings", "list"], { from: "user" })
  expect(profiles).toEqual(["first-example", "second-example"])
  let apiCalls = 0
  deps.readFiles = async () => []
  deps.fetch = async () => {
    apiCalls++
    return reply({ meetings: [] })
  }
  deps.tokens.save({
    accessToken: "example",
    refreshToken: "example",
    expiresAt: 3600000,
    scopes: ["meeting:read:list_meetings"],
  })
  await program.parseAsync(["config", "set", "source", "files"], { from: "user" })
  await program.parseAsync(["config", "set", "files.folder", "example-folder"], { from: "user" })
  await program.parseAsync(["meetings", "sync", "--since-time", "2026-10-01"], { from: "user" })
  expect(apiCalls).toBe(0)
  await program.parseAsync(["config", "set", "source", "api"], { from: "user" })
  await program.parseAsync(["meetings", "sync", "--since-time", "2026-10-01"], { from: "user" })
  expect(apiCalls).toBe(1)
})

it("rejects concurrent direct parses without disturbing the running connection", async () => {
  const { createProgram } = await import("./program.js")
  const { deps } = await setup()
  setConfig(deps.configPath, "account.profile", "example")
  let release: () => void = () => {}
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  let opened: () => void = () => {}
  const connected = new Promise<void>((resolve) => {
    opened = resolve
  })
  let closes = 0
  deps.connectStore = async () => {
    opened()
    await wait
    return fakeConnection({
      store: memoryMeetingStore(),
      accountId: 1,
      close: async () => {
        closes++
      },
    })
  }
  const program = createProgram(deps)
  const first = program.parseAsync(["meetings", "list"], { from: "user" })
  await connected
  await expect(program.parseAsync(["meetings", "list"], { from: "user" })).rejects.toThrow(/concurrent/)
  expect(closes).toBe(0)
  release()
  await first
  expect(closes).toBe(1)
})
