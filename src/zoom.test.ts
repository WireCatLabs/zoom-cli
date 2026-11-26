import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { importFiles, pull } from "@wirecat/cli-core/meetings"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { TOKEN_LOG_ALLOW } from "@wirecat/cli-core/oauth"
import { describe, expect, it } from "vitest"
import { readAnswer, readJsonl } from "../scripts/testing/answers.js"
import { encodeUuid, ZoomApiSource } from "./api.js"
import { readConfig, setConfig } from "./config.js"
import { number, object, string } from "./errors.js"
import { FilesSource, fileMeeting, importFile, readDownloadedFiles } from "./files.js"
import { type ProgramDeps, run } from "./program.js"
import { lazyRunLog } from "./run-log.js"
import { REDIRECT, TokenManager } from "./tokens.js"

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
  }).forProfile("example")
  return tokens
}
const authorize = (tokens: TokenManager, expiresAt = 3600000) => {
  tokens.save({ accessToken: "example-access", refreshToken: "example-refresh", scopes, expiresAt })
  return tokens
}
const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Example plan\n"
const file = { name: "2026-10-10_1530_example-planning.vtt", content: vtt }
const temporary = () => mkdtemp(join(tmpdir(), "zm-test-"))

describe("token refresh log", () => {
  it("records cli-core's oauth.token event for each refresh, never token material", async () => {
    const runsDir = join(await temporary(), "runs")
    const run = lazyRunLog({ runsDir, command: "oauth token", version: "0.0.0", allow: TOKEN_LOG_ALLOW })
    const replies = [
      response({ access_token: "example-issued-1", refresh_token: "example-rotated-1", expires_in: 1 }),
      response({ reason: "example-refresh rejected" }, 400),
    ]
    const tokens = new TokenManager({
      ...tokenManager().options,
      log: run.log,
      fetch: async () => replies.shift() ?? response({}, 500),
    })
    authorize(tokens, 0)
    await tokens.tokens()
    await expect(tokens.tokens()).rejects.toMatchObject({ code: "authentication_error" })
    await run.finish("failed")
    const [day] = (await readdir(runsDir)).filter((name) => !name.startsWith("."))
    const [id] = (await readdir(join(runsDir, day ?? ""))).filter((name) => name !== "index.jsonl")
    const text = await readFile(join(runsDir, day ?? "", id ?? "", "events.jsonl"), "utf8")
    const records = text
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(records.map((record) => record.attributes)).toEqual([
      expect.objectContaining({ event: "oauth.token", provider: "zoom", operation: "refresh_token", rotated: true }),
      expect.objectContaining({ event: "oauth.token", operation: "refresh_token", outcome: "rejected", status: 400 }),
    ])
    expect(text).not.toMatch(/example-(access|refresh|rotated|issued)/)
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
    expect((await store.search("Example plan")).items.length).toBe(2)
    const [saved] = await store.meetings()
    expect((await store.meeting(saved?.id ?? 0))?.summaries[0]).toMatchObject({
      source: "zoom-ai",
      docUrl: "https://example.com/summary",
      externalCreatedAt: Date.parse("2026-10-10T15:30:00Z"),
      metadata: { example_hint: "invented" },
    })
    expect(await source.chat("example")).toBeNull()
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
    const refused = (reason: string) =>
      new ZoomApiSource(tokens, async () =>
        response({ can_download: false, download_restriction_reason: reason }),
      ).transcript("example")
    await expect(refused("NOT_READY")).rejects.toThrow(/not finished this transcript yet/)
    for (const reason of ["NO_TRANSCRIPT_DATA", "DELETED_OR_TRASHED", "UNSUPPORTED"])
      expect(await refused(reason)).toBeNull()
  })

  it("reads the chat saved with the cloud recording, and none without the scope or a chat file", async () => {
    const recorded = (files: unknown[]) => async (input: string | URL | Request) =>
      String(input).includes("example-chat")
        ? new Response("00:00:30\tAlice Example:\tSee https://example.com/plan\n")
        : response({ start_time: "2026-10-20T09:00:00Z", recording_files: files })
    const chatFile = {
      file_type: "CHAT",
      status: "completed",
      recording_start: "2026-10-20T09:01:00Z",
      download_url: "https://zoom.us/example-chat",
    }
    expect(await new ZoomApiSource(authorize(tokenManager()), recorded([chatFile])).chat("example")).toBeNull()
    const tokens = tokenManager()
    tokens.save({
      accessToken: "example-access",
      refreshToken: "example-refresh",
      scopes: [...scopes, "cloud_recording:read:list_recording_files"],
      expiresAt: 3600000,
    })
    expect(await new ZoomApiSource(tokens, recorded([chatFile])).chat("example")).toEqual([
      { sentAt: "2026-10-20T09:01:30.000Z", sender: "Alice Example", text: "See https://example.com/plan" },
    ])
    expect(await new ZoomApiSource(tokens, recorded([{ ...chatFile, file_type: "MP4" }])).chat("example")).toBeNull()
    expect(await new ZoomApiSource(tokens, async () => response({ code: 3301 }, 404)).chat("example")).toBeNull()
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
const zoomUser: typeof fetch = async () =>
  response({ id: "example-user", email: "user@example.com", display_name: "Example User" })
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
    expect(await run(["config", "set", "zoom.client_id", "example-client"], deps)).toBe(0)
    expect(await run(["--json", "config", "show"], deps)).toBe(0)
    expect(readAnswer(stdout[1] ?? "{}")).toHaveProperty("client_id", "example-client")
    setConfig(deps.configPath, "files.timezone", "Europe/Madrid")
    setConfig(deps.configPath, "source", "files")
    setConfig(deps.configPath, "files.folder", "example-folder")
    for (const [key, value] of [
      ["unknown", "value"],
      ["source", "browser"],
      ["zoom.client_id", " "],
      ["files.folder", " "],
      ["files.timezone", "invalid"],
    ])
      expect(() => setConfig(deps.configPath, key ?? "", value ?? "")).toThrow()
    await writeFile(deps.configPath, "invalid")
    expect(() => readConfig(deps.configPath)).toThrow(/not valid JSON/)
    await writeFile(deps.configPath, "{}")
    expect(readConfig(deps.configPath)).toMatchObject({ clientId: null, source: "api", filesFolder: null })
  })
  it("imports a folder through the real command and lists its meeting in memory", async () => {
    const { deps, stdout } = await programSetup()
    expect(await run(["meetings", "import", "example-folder", "--json"], deps)).toBe(0)
    expect(readAnswer(stdout[0] ?? "{}")).toMatchObject({ meetings: 1 })
    expect(await run(["--jsonl", "meetings", "list"], deps)).toBe(0)
    expect(readJsonl(stdout[1] ?? "")[0]).toHaveProperty("title")
    expect(await run(["--help"], deps)).toBe(0)
    expect(await run(["--version"], deps)).toBe(0)
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
    expect(await run(["session", "start"], deps)).toBe(2)
    expect(await run(["example", "session", "start"], deps)).toBe(3)
  })
  it("keeps the login in a private file with --credential-storage file", async () => {
    const configDir = await temporary()
    const setup = await programSetup({
      env: { ZM_CONFIG_DIR: configDir },
      signInFetch: tokenManager().options.fetch,
      fetch: zoomUser,
      openBrowser: async (url) => {
        const state = new URL(url).searchParams.get("state") ?? ""
        await fetch(
          `http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, code: "example-code" })}`,
        )
      },
    })
    setConfig(setup.deps.configPath, "zoom.client_id", "example-client")
    const start = ["example", "--json", "session", "start"]
    expect(await run([...start, "--credential-storage", "file"], setup.deps)).toBe(0)
    expect(readAnswer(setup.stdout[0] ?? "{}")).toMatchObject({ signed_in: true })
    expect(JSON.parse(await readFile(join(configDir, "credentials.json"), "utf8"))).toHaveProperty([
      "oauth:zoom:example",
    ])
    expect(await run([...start, "--credential-storage", "cloud"], setup.deps)).toBe(2)
  })
  it("logs in through an injected browser and exposes only status and grants", async () => {
    let authorized: URL | undefined
    const setup = await programSetup({
      signInFetch: tokenManager().options.fetch,
      fetch: zoomUser,
      openBrowser: async (url) => {
        authorized = new URL(url)
        const state = authorized.searchParams.get("state") ?? ""
        await fetch(
          `http://127.0.0.1:${state.split(".")[0]}/callback?${new URLSearchParams({ state, code: "example-code" })}`,
        )
      },
    })
    setConfig(setup.deps.configPath, "zoom.client_id", "example-client")
    expect(await run(["example", "--json", "session", "start"], setup.deps)).toBe(0)
    expect(authorized?.searchParams.get("redirect_uri")).toBe(REDIRECT)
    expect(authorized?.searchParams.get("code_challenge_method")).toBe("S256")
    expect(authorized?.searchParams.has("scope")).toBe(false)
    expect(readAnswer(setup.stdout[0] ?? "{}")).toEqual({
      signed_in: true,
      scopes,
      profile: "example",
      user_id: "example-user",
      email: "user@example.com",
      display_name: "Example User",
    })
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
  expect(() => readConfig(setup.deps.configPath)).toThrow(
    `${setup.deps.configPath}: setting unexpected is not a setting of zm — remove it with \`zm config unset unexpected\``,
  )
  expect(() => readConfig(setup.deps.configPath)).not.toThrow(/example-private-value/)
  expect(await run(["example", "unknown-command"], setup.deps)).toBe(2)
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
