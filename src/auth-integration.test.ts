import { mkdtemp, writeFile } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-core"
import { memoryMeetingStore } from "@wirecat/cli-meetings/testing"
import { describe, expect, it } from "vitest"
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
      code: "provider_error",
      message: "could not reach Zoom token endpoint; retry the command",
    })
    expect(calls).toBe(1)
    await expect(manager(async () => new Response("invalid JSON")).exchange({})).rejects.toMatchObject({
      code: "invalid_response",
    })
    for (const extra of [{ scope: [] }, { refresh_token: 1 }, { expires_in: Number.MAX_VALUE }])
      await expect(
        manager(async () =>
          reply({ access_token: "example", refresh_token: "example", expires_in: 60, ...extra }),
        ).exchange({}),
      ).rejects.toMatchObject({ code: "invalid_response" })
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
    expect(await run(["--no-input", "login"], deps)).toBe(3)
  })
  it("reports browser and token exchange failures with their structured exit codes", async () => {
    const { deps, stderr } = await setup()
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    expect(await run(["login"], deps)).toBe(3)
    expect(JSON.parse(stderr.at(-1) ?? "{}").error.code).toBe("configuration_error")
    deps.openBrowser = async (url) => {
      await fetch(callback(url, { code: "example-code" }))
    }
    expect(await run(["login"], deps)).toBe(11)
    expect(JSON.parse(stderr.at(-1) ?? "{}").error.code).toBe("provider_error")
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
    expect(await run(["pull", "--since", "2026-10-01"], deps)).toBe(0)
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
  expect(await run(["pull", "--since", "2026-10-01"], deps)).toBe(0)
  const { FilesSource } = await import("./files.js")
  deps.source = new FilesSource([])
  expect(await run(["pull", "--since", "2026-10-01"], deps)).toBe(0)
})
