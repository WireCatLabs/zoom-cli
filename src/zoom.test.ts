import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brokenKeyring, CliError, memoryKeyring } from "@wirecat/cli-base"
import { importFiles, pull } from "@wirecat/cli-core/meetings"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { describe, expect, it } from "vitest"
import { readAnswer, readJsonl } from "../scripts/testing/answers.js"
import { encodeUuid, ZoomApiSource } from "./api.js"
import { readConfig, setConfig } from "./config.js"
import { number, object, string } from "./errors.js"
import { FilesSource, fileMeeting, importFile, readDownloadedFiles } from "./files.js"
import { login, REDIRECT } from "./login.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { lazyRunLog } from "./run-log.js"
import { TOKEN_LOG_ALLOW, TokenManager } from "./tokens.js"

const scopes = [
  "meeting:read:list_meetings",
  "meeting:read:list_past_instances",
  "meeting:read:list_past_participants",
  "cloud_recording:read:meeting_transcript",
  "meeting:read:summary",
]
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
const tokenManager = (
  fetcher: typeof fetch = async () =>
    response({
      access_token: "example-access",
      refresh_token: "example-refresh",
      expires_in: 3600,
      scope: scopes.join(" "),
    }),
) => {
  const tokens = new TokenManager({
    clientId: "example-client",
    keyring: memoryKeyring(),
    service: "example-service",
    fetch: fetcher,
    now: () => 0,
  })
  return tokens
}
const authorize = (tokens: TokenManager, expiresAt = 3600000) => {
  tokens.save({ accessToken: "example-access", refreshToken: "example-refresh", scopes, expiresAt })
  return tokens
}
const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Example plan\n"
const file = { name: "2026-10-10_1530_example-planning.vtt", content: vtt }
const temporary = () => mkdtemp(join(tmpdir(), "zm-test-"))

describe("tokens", () => {
  it("saves only to the injected keyring, refreshes once and reads actual grants", async () => {
    let calls = 0
    const tokens = authorize(
      tokenManager(async (_url, init) => {
        calls++
        const form = new URLSearchParams(String(init?.body))
        expect(form.get("client_id")).toBe("example-client")
        expect(form.get("client_secret")).toBeNull()
        expect(form.get("grant_type")).toBe("refresh_token")
        expect(init?.headers).not.toHaveProperty("authorization")
        return response({ access_token: "example-new", expires_in: 60 })
      }),
      0,
    )
    const [a, b] = await Promise.all([tokens.tokens(), tokens.tokens()])
    expect(calls).toBe(1)
    expect(a).toEqual(b)
    expect(a.refreshToken).toBe("example-refresh")
    expect(a.scopes).toEqual(scopes)
    expect((await tokens.tokens()).accessToken).toBe("example-new")
    const empty = tokenManager(async () =>
      response({ access_token: "example-access", refresh_token: "example-refresh", expires_in: 60 }),
    )
    expect((await empty.exchange({ grant_type: "authorization_code" })).scopes).toEqual([])
  })
  it("refuses missing, corrupt or unavailable keyring entries and invalid token replies", async () => {
    const tokens = tokenManager()
    expect(tokens.load()).toBeNull()
    await expect(tokens.tokens()).rejects.toThrow(/session start first/)
    tokens.options.keyring.set("example-service", "example-client", "broken")
    expect(() => tokens.load()).toThrow(/invalid/)
    tokens.options.keyring.set(
      "example-service",
      "example-client",
      JSON.stringify({ accessToken: "", refreshToken: "", expiresAt: 1, scopes: [] }),
    )
    expect(() => tokens.load()).toThrow(/invalid/)
    const broken = new TokenManager({ ...tokens.options, keyring: brokenKeyring() })
    expect(() => broken.load()).toThrow(/unavailable/)
    expect(() => broken.save({ accessToken: "example", refreshToken: "example", expiresAt: 1, scopes: [] })).toThrow(
      /save/,
    )
    for (const body of [{}, { access_token: "example", refresh_token: "example", expires_in: -1 }, null])
      await expect(tokenManager(async () => response(body)).exchange({})).rejects.toThrow()
    await expect(tokenManager(async () => response({}, 401)).exchange({})).rejects.toThrow(/HTTP 401/)
  })
})
describe("token refresh log", () => {
  const secrets = /example-(access|refresh|rotated|issued)/
  const loggedRun = async () => {
    const runsDir = join(await temporary(), "runs")
    return { runsDir, run: lazyRunLog({ runsDir, command: "oauth token", version: "0.0.0", allow: TOKEN_LOG_ALLOW }) }
  }
  const events = async (runsDir: string) => {
    const [day] = await readdir(runsDir)
    const [id] = (await readdir(join(runsDir, day ?? ""))).filter((name) => name !== "index.jsonl")
    const text = await readFile(join(runsDir, day ?? "", id ?? "", "events.jsonl"), "utf8")
    return {
      text,
      records: text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
    }
  }
  it("writes nothing until a token exchange happens", async () => {
    const { runsDir, run } = await loggedRun()
    const tokens = authorize(new TokenManager({ ...tokenManager().options, log: run.log }))
    await tokens.tokens()
    await run.finish("success")
    await expect(readdir(runsDir)).rejects.toThrow()
  })
  it("records each refresh outcome with status, rotation, save and pid, never token material", async () => {
    const { runsDir, run } = await loggedRun()
    const keyring = memoryKeyring()
    const replies = [
      response({ access_token: "example-issued-1", refresh_token: "example-rotated-1", expires_in: 1 }),
      response({ reason: "example-refresh rejected" }, 400),
      response({ access_token: "example-issued-2", refresh_token: "example-rotated-1", expires_in: 1 }),
    ]
    const tokens = new TokenManager({
      ...tokenManager().options,
      keyring,
      log: run.log,
      now: () => 0,
      fetch: async () => replies.shift() ?? response({}, 500),
    })
    authorize(tokens, 0)
    await tokens.tokens()
    await expect(tokens.tokens()).rejects.toThrow(/HTTP 400/)
    keyring.set = () => {
      throw new Error("example locked keyring")
    }
    await expect(tokens.tokens()).rejects.toThrow(/could not save/)
    const controller = new AbortController()
    const cancelled = new TokenManager({
      ...tokens.options,
      fetch: async () => {
        controller.abort()
        throw new Error("example aborted")
      },
    }).withSignal(controller.signal)
    await expect(cancelled.tokens()).rejects.toThrow(/did not finish/)
    const deadline = new AbortController()
    const expired = new TokenManager({
      ...tokens.options,
      fetch: async () => {
        deadline.abort(new CliError("timeout", "example deadline"))
        throw new Error("example aborted")
      },
    }).withSignal(deadline.signal)
    await expect(expired.tokens()).rejects.toThrow(/did not finish/)
    await run.finish("failed")
    const { text, records } = await events(runsDir)
    expect(records.map((record) => [record.body, record.attributes])).toEqual([
      [
        "zoom.token.exchange",
        {
          event: "zoom.token.exchange",
          operation: "refresh_token",
          pid: process.pid,
          outcome: "saved",
          status: 200,
          rotated: true,
          saved: true,
        },
      ],
      [
        "zoom.token.exchange",
        {
          event: "zoom.token.exchange",
          operation: "refresh_token",
          pid: process.pid,
          outcome: "rejected",
          status: 400,
        },
      ],
      [
        "zoom.token.exchange",
        {
          event: "zoom.token.exchange",
          operation: "refresh_token",
          pid: process.pid,
          outcome: "save_failed",
          status: 200,
          rotated: false,
          saved: false,
        },
      ],
      [
        "zoom.token.exchange",
        {
          event: "zoom.token.exchange",
          operation: "refresh_token",
          pid: process.pid,
          reason: "cancelled",
          outcome: "no_response",
        },
      ],
      [
        "zoom.token.exchange",
        {
          event: "zoom.token.exchange",
          operation: "refresh_token",
          pid: process.pid,
          reason: "timeout",
          outcome: "no_response",
        },
      ],
    ])
    expect(text).not.toMatch(secrets)
    expect(text).not.toContain("not allowed")
  })
})
describe("PKCE login", () => {
  it("validates callback state, exchanges PKCE and closes the listener", async () => {
    let challenge = ""
    let callback = ""
    const tokens = tokenManager(async (_url, init) => {
      const params = new URLSearchParams(String(init?.body))
      expect(params.get("redirect_uri")).toBe(REDIRECT)
      expect(
        createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url"),
      ).toBe(challenge)
      expect(params.get("code")).toBe("example-code")
      return response({
        access_token: "example-access",
        refresh_token: "example-refresh",
        expires_in: 3600,
        scope: "meeting:read:list_meetings",
      })
    })
    const result = await login({
      tokens,
      openBrowser: async (url) => {
        const parsed = new URL(url)
        expect(parsed.searchParams.get("redirect_uri")).toBe(REDIRECT)
        const state = parsed.searchParams.get("state") ?? ""
        challenge = parsed.searchParams.get("code_challenge") ?? ""
        callback = `http://127.0.0.1:${state.split(".")[0]}`
        expect((await fetch(`${callback}/unknown`)).status).toBe(404)
        expect((await fetch(`${callback}/callback?state=wrong&code=example`)).status).toBe(400)
        await fetch(`${callback}/callback?${new URLSearchParams({ state, code: "example-code" })}`)
      },
    })
    expect(result).toEqual({ loggedIn: true, scopes: ["meeting:read:list_meetings"] })
    await expect(fetch(`${callback}/callback`)).rejects.toThrow()
  })
  it("accepts pasted callback parameters when browser launch fails", async () => {
    let url = ""
    const result = await login({
      tokens: tokenManager(),
      showUrl: (value) => {
        url = value
      },
      openBrowser: async () => {
        throw new Error("browser unavailable")
      },
      readPaste: async () =>
        `https://wirecat.dev/zoom-callback?code=example-code&state=${new URL(url).searchParams.get("state")}`,
    })
    expect(result.loggedIn).toBe(true)
    await expect(
      login({ tokens: tokenManager(), openBrowser: async () => {}, readPaste: async () => "code=example&state=wrong" }),
    ).rejects.toThrow(/matching/)
  })
  it("handles refused approval and timeout without leaving a listener", async () => {
    await expect(
      login({
        tokens: tokenManager(),
        openBrowser: async (url) => {
          const state = new URL(url).searchParams.get("state") ?? ""
          await fetch(
            `http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, error: "access_denied" })}`,
          )
        },
      }),
    ).rejects.toThrow(/not approved/)
    await expect(login({ tokens: tokenManager(), openBrowser: async () => {}, timeoutMs: 10 })).rejects.toThrow(
      /timed out/,
    )
  })
})
const apiFixture = (): typeof fetch => async (input, init) => {
  const url = new URL(String(input))
  expect(init?.headers).toHaveProperty("authorization", "Bearer example-access")
  if (url.pathname === "/v2/users/me/meetings")
    return response({
      meetings: url.searchParams.has("next_page_token")
        ? []
        : [
            {
              id: 100,
              uuid: "example-series-uuid",
              topic: "Example planning",
              type: 8,
              start_time: "2026-10-10T15:30:00Z",
              join_url: "https://zoom.us/example-room",
              timezone: "UTC",
              recurrence: { type: 1 },
              metadata_example: { enabled: true },
            },
            {
              id: "101",
              uuid: "example-once",
              topic: "Example one-off",
              type: 1,
              start_time: "2026-10-10T15:30:00Z",
              duration: 10,
            },
          ],
      next_page_token: url.searchParams.has("next_page_token") ? "" : "example-next",
    })
  if (url.pathname === "/v2/past_meetings/100/instances")
    return response({
      meetings: [
        { uuid: "/example//occurrence", start_time: "2026-10-10T15:30:00Z" },
        { uuid: "old-example", start_time: "2026-01-01T00:00:00Z" },
      ],
    })
  if (url.pathname === "/v2/past_meetings/101/instances")
    return response({ meetings: [{ uuid: "example/once-instance", start_time: "2026-10-10T15:31:00Z" }] })
  if (url.pathname.endsWith("/participants"))
    return response({
      participants: [
        {
          id: "alice-example",
          user_id: "session-example-1",
          name: "Alice Example",
          user_email: "alice@example.com",
          join_time: "2026-10-10T15:30:00Z",
          leave_time: "2026-10-10T15:35:00Z",
          duration: 300,
        },
        {
          id: "alice-example",
          user_id: "session-example-2",
          name: "Alice Example",
          user_email: "alice@example.com",
          join_time: "2026-10-10T15:36:00Z",
          leave_time: "2026-10-10T15:40:00Z",
          duration: 240,
        },
      ],
      next_page_token: "",
    })
  if (url.pathname.endsWith("/transcript")) return response({ download_url: "https://zoom.us/example-download" })
  if (url.pathname === "/example-download") return new Response(vtt)
  if (url.pathname.endsWith("/meeting_summary"))
    return response({
      summary_title: "Example summary",
      summary_doc_url: "https://example.com/summary",
      summary_created_time: "2026-10-10T15:30:00Z",
      summary_last_modified_time: "2026-10-10T15:40:00Z",
      example_hint: "invented",
      summary_overview: "Example overview",
      summary_details: [{ label: "Plan", summary: "Example section" }],
      next_steps: ["Example next step", 1],
    })
  throw new Error("unscripted request")
}
describe("API source", () => {
  it("paginates series, uses occurrence UUIDs, groups joins and pulls into the memory store", async () => {
    const source = new ZoomApiSource(authorize(tokenManager()), apiFixture())
    const meetings = await source.meetings("2026-10-01T00:00:00Z")
    expect(meetings.length).toBe(2)
    expect(meetings[0]?.occurrence.id).toBe("/example//occurrence")
    expect(meetings[0]?.occurrence.endedAt).toBeNull()
    const participants = await source.participants("/example//occurrence")
    expect(participants.length).toBe(1)
    expect(participants[0]?.durationMs).toBe(540000)
    expect(participants[0]?.sessions).toHaveLength(2)
    const store = memoryMeetingStore()
    const result = await pull(source, store, {
      accountId: 1,
      since: "2026-10-01T00:00:00Z",
      now: Date.UTC(2026, 9, 11),
    })
    expect(result.meetings).toBe(2)
    expect(result.warnings).toEqual([])
    expect((await store.search("Example plan")).length).toBe(2)
    const [saved] = await store.meetings()
    expect((await store.meeting(saved?.id ?? 0))?.summaries[0]).toMatchObject({
      source: "zoom-ai",
      docUrl: "https://example.com/summary",
      externalCreatedAt: Date.parse("2026-10-10T15:30:00Z"),
      metadata: { example_hint: "invented" },
    })
    expect(await source.chat()).toBeNull()
    expect(await source.files()).toBeNull()
    expect(encodeUuid("/example//uuid")).toBe(encodeURIComponent(encodeURIComponent("/example//uuid")))
    expect(encodeUuid("example+uuid")).toBe("example%2Buuid")
  })
  it("stores the same API instants whatever the process zone", async () => {
    const saved = process.env.TZ
    const read = async (zone: string) => {
      process.env.TZ = zone
      const source = new ZoomApiSource(authorize(tokenManager()), apiFixture())
      const meetings = await source.meetings("2026-10-01T00:00:00Z")
      const participants = await source.participants("/example//occurrence")
      return { starts: meetings.map((row) => row.occurrence.startedAt), joins: participants[0]?.sessions }
    }
    try {
      const east = await read("Asia/Vladivostok")
      expect(await read("America/Los_Angeles")).toEqual(east)
      expect(east.starts[0]).toBe("2026-10-10T15:30:00.000Z")
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })
  it.each([
    ["Asia/Vladivostok", "2026-10-10T05:30:00.000Z"],
    ["America/Los_Angeles", "2026-10-10T22:30:00.000Z"],
  ])("reads a zone-less Zoom time in the computer's zone, %s, and marks the record", async (zone, instant) => {
    const saved = process.env.TZ
    process.env.TZ = zone
    try {
      const source = new ZoomApiSource(authorize(tokenManager()), async (input) =>
        String(input).includes("/participants")
          ? response({ participants: [{ id: "alice-example", join_time: "2026-10-10T15:30:00", duration: 60 }] })
          : response({ participants: [] }),
      )
      const [participant] = await source.participants("example")
      expect(participant?.joinedAt).toBe(Date.parse(instant))
      expect(participant?.metadata).toMatchObject({ issues: ["time_without_zone"] })
      expect(source.zones.take()).toEqual([`1 Zoom time had no zone; read in ${zone} and marked time_without_zone`])
      expect(source.zones.take()).toEqual([])
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })
  it("reads a zone-less time that daylight saving skips as UTC, and says so", async () => {
    const saved = process.env.TZ
    process.env.TZ = "America/Los_Angeles"
    try {
      const source = new ZoomApiSource(authorize(tokenManager()), async () =>
        response({ participants: [{ id: "alice-example", join_time: "2026-03-08T02:30:00", duration: 60 }] }),
      )
      const [participant] = await source.participants("example")
      expect(participant?.joinedAt).toBe(Date.parse("2026-03-08T02:30:00Z"))
      expect(source.zones.take()).toEqual(["1 Zoom time had no zone; read in UTC and marked time_without_zone"])
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })
  it("leaves a record whose times name their zone unmarked", async () => {
    const source = new ZoomApiSource(authorize(tokenManager()), apiFixture())
    const [meeting] = await source.meetings("2026-10-01T00:00:00Z")
    expect(meeting?.metadata).not.toHaveProperty("issues")
    expect(source.zones.take()).toEqual([])
  })
  it.each(["2026-10-10", "2026-10-10 15:30:00Z", "2026-02-30T15:30:00", "2026-10-10T25:00:00", "example"])(
    "refuses a malformed Zoom join time: %s",
    async (join_time) => {
      const source = new ZoomApiSource(authorize(tokenManager()), async () =>
        response({ participants: [{ id: "alice-example", join_time, duration: 60 }] }),
      )
      await expect(source.participants("example")).rejects.toMatchObject({
        code: "invalid_response",
        message: "Zoom returned an invalid timestamp",
      })
    },
  )
  it("handles optional identities, independent nameless guests and missing timestamps", async () => {
    const source = new ZoomApiSource(authorize(tokenManager()), async () =>
      response({
        participants: [
          { id: "", user_email: "alice@example.com", duration: 5 },
          { user_email: "ALICE@example.com", duration: 2 },
          { registrant_id: "example-registrant" },
          {
            registrant_id: "example-registrant",
            join_time: "2026-10-10T00:00:00Z",
            leave_time: "2026-10-10T00:01:00Z",
            duration: 60,
          },
          { name: "Bob Sample" },
          { name: "Bob Sample" },
          {},
        ],
      }),
    )
    const participants = await source.participants("example")
    expect(participants.length).toBe(5)
    expect(participants[0]?.durationMs).toBe(7000)
    expect(participants[2]?.identityExternalId).toBeNull()
  })
  it("names missing scopes, sanitizes provider errors and rejects malformed pages", async () => {
    const missing = authorize(tokenManager())
    const saved = missing.load()
    if (!saved) throw new Error("missing fixture")
    missing.save({ ...saved, scopes: [] })
    await expect(new ZoomApiSource(missing, apiFixture()).participants("example")).rejects.toThrow(
      /meeting:read:list_past_participants/,
    )
    for (const [body, status, pattern] of [
      [{ code: 4711, message: "private example" }, 400, /scope/],
      [{ code: 3001, message: "private example" }, 403, /HTTP 403/],
      [{}, 401, /HTTP 401/],
      [null, 200, /invalid/],
      [{ participants: {} }, 200, /invalid list/],
    ] as [unknown, number, RegExp][]) {
      await expect(
        new ZoomApiSource(authorize(tokenManager()), async () => response(body, status)).participants("example"),
      ).rejects.toThrow(pattern)
    }
    const cyclic = new ZoomApiSource(authorize(tokenManager()), async () =>
      response({ participants: [], next_page_token: "example-next" }),
    )
    await expect(cyclic.participants("example")).rejects.toThrow(/repeated/)
    await expect(new ZoomApiSource(authorize(tokenManager()), apiFixture()).meetings("bad")).rejects.toThrow(/since/)
  })
  it("reads missing/modern/edited summaries and protects transcript bearer downloads", async () => {
    const tokens = authorize(tokenManager())
    expect(await new ZoomApiSource(tokens, async () => response({ code: 3322 }, 404)).transcript("example")).toBeNull()
    expect(await new ZoomApiSource(tokens, async () => response({ code: 3001 }, 404)).summary("example")).toBeNull()
    expect(
      (
        await new ZoomApiSource(tokens, async () => response({ summary_content: "Example full summary" })).summary(
          "example",
        )
      )?.content,
    ).toBe("Example full summary")
    expect(
      (
        await new ZoomApiSource(tokens, async () =>
          response({ edited_summary: { summary_overview: "Edited example", next_steps: ["Example step"] } }),
        ).summary("example")
      )?.overview,
    ).toBe("Edited example")
    for (const target of ["http://zoom.us/example", "https://example.com/file", "https://user@zoom.us/file"])
      await expect(
        new ZoomApiSource(tokens, async () => response({ download_url: target })).transcript("example"),
      ).rejects.toThrow(/host/)
    await expect(
      new ZoomApiSource(tokens, async (input) =>
        String(input).includes("example-download")
          ? new Response("", { status: 403 })
          : response({ download_url: "https://zoom.us/example-download" }),
      ).transcript("example"),
    ).rejects.toThrow(/HTTP 403/)
    await expect(new ZoomApiSource(tokens, async () => response({})).transcript("example")).rejects.toThrow(/required/)
  })
})
describe("downloaded files", () => {
  it("uses legacy names, timezones, deterministic ids and idempotent import", async () => {
    const source = new FilesSource([file])
    const [meeting] = await source.meetings("2026-10-01T00:00:00Z")
    expect(meeting?.occurrence.startedAt).toBe("2026-10-10T15:30:00.000Z")
    expect(fileMeeting(file.name, "Europe/Madrid").occurrence.startedAt).toBe("2026-10-10T13:30:00.000Z")
    expect((await source.transcript(meeting?.occurrence.id ?? ""))?.[0]?.speaker).toBe("Alice Example")
    expect(await source.transcript("unknown")).toBeNull()
    expect(await source.participants()).toBeNull()
    expect(await source.chat()).toBeNull()
    expect(await source.summary()).toBeNull()
    expect(await source.files()).toBeNull()
    expect(await source.meetings("2027-01-01T00:00:00Z")).toEqual([])
    const store = memoryMeetingStore()
    await importFiles([importFile(file, 1)], store)
    await importFiles([importFile(file, 1)], store)
    const [m] = await store.meetings()
    const d = await store.meeting(m?.id ?? 0)
    expect(d?.transcripts.length).toBe(1)
    expect(d?.transcripts[0]?.rows[0]?.speakerParticipantId).toBeNull()
  })
  it("rejects broken names, invalid dates and DST ambiguity, and skips files that are not transcripts", async () => {
    for (const name of ["bad.vtt", "2026-02-30_1530_example.vtt", "2026-10-10_2460_example.vtt"])
      expect(() => fileMeeting(name)).toThrow()
    expect(() => fileMeeting("2026-10-25_0230_example.vtt", "Europe/Madrid")).toThrow(/ambiguous/)
    expect(() => fileMeeting("2026-03-29_0230_example.vtt", "Europe/Madrid")).toThrow(/nonexistent/)
    await expect(new FilesSource([file]).meetings("bad")).rejects.toThrow()
    const dir = await temporary()
    await writeFile(join(dir, file.name), file.content)
    await writeFile(join(dir, "example.txt"), "Example")
    await mkdir(join(dir, "folder.vtt"))
    expect(await readDownloadedFiles(dir)).toEqual([file])
  })

  it("reports a missing folder or a plain file as a normal error", async () => {
    const dir = await temporary()
    await writeFile(join(dir, "plain.txt"), "Example")
    await expect(readDownloadedFiles(join(dir, "missing"))).rejects.toMatchObject({
      code: "not_found",
      message: `folder not found: ${join(dir, "missing")}`,
    })
    await expect(readDownloadedFiles(join(dir, "plain.txt"))).rejects.toMatchObject({ code: "validation_error" })
  })
})
const programSetup = async (overrides: Partial<ProgramDeps> = {}) => {
  const dir = await temporary()
  const configPath = join(dir, "config.json")
  const stdout: string[] = []
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath,
    tokens: tokenManager(),
    fetch: apiFixture(),
    store: memoryMeetingStore(),
    accountId: 1,
    readFiles: async () => [file],
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
    now: () => Date.UTC(2026, 9, 11),
    ...overrides,
  }
  return { deps, stdout, stderr }
}
describe("zm", () => {
  it("shows commander's own message for a mistyped command, a missing argument and an unknown option", async () => {
    const { deps, stdout, stderr } = await programSetup()
    for (const [args, message] of [
      [["meetings", "lst"], /unknown command 'lst'.*list/],
      [["search", "recordings"], /missing required argument 'directory'/],
      [["meetings", "show", "--bogus"], /unknown option '--bogus'/],
    ] as const) {
      stdout.length = 0
      stderr.length = 0
      expect(await run([...args], deps)).toBe(2)
      expect(`${stdout.join("")}${stderr.join("")}`).toMatch(message)
    }
  })

  it("exits 6 with a folder-not-found message when the import folder is missing", async () => {
    const dir = await temporary()
    const missing = join(dir, "missing")
    const { deps, stdout, stderr } = await programSetup({ readFiles: undefined })
    expect(await run(["meetings", "import", missing], deps)).toBe(6)
    expect(`${stdout.join("")}${stderr.join("")}`).toContain(`folder not found: ${missing}`)
  })

  it("configures the public client, validates keys and keeps config nonsecret", async () => {
    const { deps, stdout } = await programSetup()
    expect(readConfig(deps.configPath).clientId).toBeNull()
    expect(await run(["config", "set", "zoom.clientId", "example-client"], deps)).toBe(0)
    expect(await run(["--json", "config", "show"], deps)).toBe(0)
    expect(readAnswer(stdout[1] ?? "{}")).toHaveProperty("client_id", "example-client")
    setConfig(deps.configPath, "files.timezone", "Europe/Madrid")
    setConfig(deps.configPath, "source", "files")
    setConfig(deps.configPath, "files.folder", "example-folder")
    for (const [key, value] of [
      ["unknown", "value"],
      ["source", "browser"],
      ["zoom.clientId", " "],
      ["files.folder", " "],
      ["files.timezone", "invalid"],
    ])
      expect(() => setConfig(deps.configPath, key ?? "", value ?? "")).toThrow()
    await writeFile(deps.configPath, "invalid")
    expect(() => readConfig(deps.configPath)).toThrow(/not valid JSON/)
    await writeFile(deps.configPath, "{}")
    expect(() => readConfig(deps.configPath)).toThrow(/client_id is missing/)
  })
  it("imports a folder through the real command and lists its meeting in memory", async () => {
    const { deps, stdout } = await programSetup()
    expect(await run(["meetings", "import", "example-folder", "--json"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}")).toMatchObject({ meetings: 1 })
    expect(await run(["--jsonl", "meetings", "list"], deps)).toBe(0)
    expect(readJsonl(stdout[1] ?? "")[0]).toHaveProperty("title")
    expect(await run(["import", "example-folder"], deps)).toBe(2)
    expect(await run(["--help"], deps)).toBe(0)
    expect(await run(["--version"], deps)).toBe(0)
    expect(createProgram(deps).commands.map((cmd) => cmd.name())).not.toContain("import")
  })
  it("pulls from the configured files source and reports missing store or source configuration", async () => {
    const { deps, stdout } = await programSetup()
    setConfig(deps.configPath, "source", "files")
    expect(await run(["meetings", "sync"], deps)).toBe(3)
    setConfig(deps.configPath, "files.folder", "example-folder")
    expect(await run(["meetings", "sync", "--since-time", "2026-10-01", "--json"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}")).toMatchObject({ meetings: 1 })
    const missing = await programSetup({ store: undefined })
    expect(await run(["meetings", "import", "example-folder"], missing.deps)).toBe(3)
    expect(await run(["meetings", "show", "1"], missing.deps)).toBe(3)
    expect(await run(["--json", "--jsonl", "config", "show"], deps)).toBe(2)
    expect(await run(["session", "start"], deps)).toBe(3)
    setConfig(deps.configPath, "zoom.clientId", "example-client")
    expect(await run(["--no-input", "session", "start"], deps)).toBe(3)
  })
  it("logs in through an injected browser and exposes only status and grants", async () => {
    const setup = await programSetup({
      openBrowser: async (url) => {
        const state = new URL(url).searchParams.get("state") ?? ""
        await fetch(
          `http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, code: "example-code" })}`,
        )
      },
    })
    setConfig(setup.deps.configPath, "zoom.clientId", "example-client")
    expect(await run(["--json", "session", "start", "--browser", "example-browser"], setup.deps)).toBe(0)
    expect(readAnswer(setup.stdout[0] ?? "{}")).toEqual({ logged_in: true, scopes })
    expect(setup.stdout.join("")).not.toContain("example-access")
  })
})
it("validates response primitives without copying private values into errors", () => {
  expect(() => object([])).toThrow()
  expect(string(1)).toBeNull()
  expect(string(" ")).toBeNull()
  expect(number(Number.NaN)).toBeNull()
  expect(number(1)).toBe(1)
})

it("config reads expose only supported public fields and parser failures are one error object", async () => {
  const setup = await programSetup()
  await writeFile(
    setup.deps.configPath,
    JSON.stringify({
      client_id: "example-client",
      source: "api",
      files_folder: null,
      files_timezone: "UTC",
      unexpected: "example-private-value",
    }),
  )
  expect(() => readConfig(setup.deps.configPath)).toThrow(`${setup.deps.configPath}: unexpected is an unknown setting`)
  expect(() => readConfig(setup.deps.configPath)).not.toThrow(/example-private-value/)
  expect(await run(["unknown-command"], setup.deps)).toBe(2)
  expect(setup.stdout).toEqual([])
  expect(setup.stderr).toHaveLength(1)
  expect(JSON.parse(setup.stderr[0] ?? "{}")).toHaveProperty("error.code", "validation_error")
})

it("keeps a file's native key when its timezone interpretation is corrected", async () => {
  expect(fileMeeting(file.name).occurrence.id).toBe(fileMeeting(file.name, "Europe/Madrid").occurrence.id)
  const store = memoryMeetingStore()
  await importFiles([importFile(file, 1, "UTC")], store)
  await importFiles([importFile(file, 1, "Europe/Madrid")], store)
  const meetings = await store.meetings()
  expect(meetings).toHaveLength(1)
  expect(meetings[0]?.startedAt).toBe(Date.parse("2026-10-10T13:30:00Z"))
})
