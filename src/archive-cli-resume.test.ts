import { access, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { planRecordingArchiveSchedule } from "@wirecat/cli-core/meetings"
import { expect, it, vi } from "vitest"
import { declaredAnswerIssue, readAnswer, readReceipt } from "../scripts/testing/answers.js"
import { useProfile } from "../scripts/testing/profile.js"
import { profileAccountKey, setConfig } from "./config.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { fileRecordingScheduleStore } from "./recording-schedule-store.js"
import type { DownloadOptions } from "./recordings.js"
import { TokenManager } from "./tokens.js"

const meeting = {
  id: "123456789",
  uuid: "example-occurrence",
  title: "Alice Example planning",
  startedAt: null,
  assets: [],
}
const report = {
  uuid: meeting.uuid,
  manifestPath: "example-manifest.json",
  downloaded: [],
  skipped: [],
  unavailable: [],
}
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-cli-resume-"))
  const output: string[] = []
  const errors: string[] = []
  const fail = async () => {
    throw new Error("unexpected external access")
  }
  const download = vi.fn(async (_id: string, _options: DownloadOptions) => report)
  const list = vi.fn(async () => [meeting])
  const catalog = vi.fn((_account: string) => ({
    provider: "zoom",
    list: async () => ({ items: [], nextCursor: null }),
  }))
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({ clientId: "example-client", service: "example", keyring: memoryKeyring(), fetch: fail }),
    fetch: fail,
    openBrowser: fail,
    connectStore: fail,
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
    recordings: { list, show: async () => meeting, download, catalog },
    now: () => Date.parse("2026-10-11T00:00:00Z"),
  }
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  const tokenAccess = vi.spyOn(deps.tokens, "forProfile")
  return { deps, directory, download, list, catalog, tokenAccess, output, errors }
}

it("defaults configured profiles to durable downloads and explicitly disables or enables resume", async () => {
  const { deps, download, tokenAccess } = await setup()
  useProfile(deps.configPath, "AliceExample")
  const args = ["recordings", "download", meeting.uuid, "--output-dir", "example", "--json"]
  for (const [flags, resume] of [
    [[], true],
    [["--no-resume"], false],
    [["--resume"], true],
  ] as const) {
    expect(await run([...args, ...flags], deps)).toBe(0)
    expect(download).toHaveBeenLastCalledWith(
      meeting.uuid,
      expect.objectContaining({ account: profileAccountKey("AliceExample"), resume }),
    )
  }
  expect(tokenAccess).not.toHaveBeenCalled()
})

it("refuses downloads and syncs without a local profile before API, tokens or archive state", async () => {
  const { deps, directory, download, list, catalog, tokenAccess, errors } = await setup()
  for (const args of [
    ["recordings", "download", meeting.uuid, "--output-dir", join(directory, "untouched"), "--json"],
    ["recordings", "download", meeting.uuid, "--output-dir", join(directory, "untouched"), "--no-resume", "--json"],
    ["recordings", "download", meeting.uuid, "--output-dir", join(directory, "untouched"), "--resume", "--json"],
    [
      "recordings",
      "download",
      "--since-time",
      "2026-10-01",
      "--until-time",
      "2026-10-11",
      "--output-dir",
      join(directory, "untouched"),
      "--resume",
      "--jsonl",
    ],
    [
      "recordings",
      "download",
      "--since-time",
      "2026-10-01",
      "--until-time",
      "2026-10-11",
      "--output-dir",
      join(directory, "untouched"),
      "--checkpoint",
      join(directory, "untouched-checkpoint"),
      "--jsonl",
    ],
  ] as const) {
    expect(await run([...args], deps)).toBe(2)
    expect(JSON.parse(errors.at(-1) ?? "{}").error).toMatchObject({
      code: "validation_error",
      details: { profiles: [] },
    })
  }
  expect(download).not.toHaveBeenCalled()
  expect(list).not.toHaveBeenCalled()
  expect(catalog).not.toHaveBeenCalled()
  expect(tokenAccess).not.toHaveBeenCalled()
  await expect(access(join(directory, "untouched"))).rejects.toMatchObject({ code: "ENOENT" })
  await expect(access(join(directory, "untouched-checkpoint"))).rejects.toMatchObject({ code: "ENOENT" })
})

it("captures account scope before an asynchronous download and refreshes it only for the next command", async () => {
  const { deps, download } = await setup()
  useProfile(deps.configPath, "AliceExample")
  download.mockImplementation(async (_id, options) => {
    useProfile(deps.configPath, "BobSample")
    await Promise.resolve()
    expect(options.account).toBe(profileAccountKey("AliceExample"))
    return report
  })
  const program = createProgram(deps)
  const args = ["recordings", "download", meeting.uuid, "--output-dir", "example", "--json"]
  await program.parseAsync(args, { from: "user" })
  download.mockImplementation(async () => report)
  await program.parseAsync([...args, "--no-resume"], { from: "user" })
  expect(download).toHaveBeenLastCalledWith(
    meeting.uuid,
    expect.objectContaining({ account: profileAccountKey("BobSample"), resume: false }),
  )
})

it("uses paged account-bound discovery and an explicit durable checkpoint with rechecks and limits", async () => {
  const { deps, directory, download, list, output } = await setup()
  useProfile(deps.configPath, "AliceExample")
  const catalogList = vi.fn(async (options: { cursor?: string }) => ({
    items: options.cursor ? [] : [{ ...meeting, externalId: meeting.uuid }],
    nextCursor: options.cursor ? null : "example-page",
  }))
  const catalog = vi.fn((account: string) => {
    expect(account).toBe(profileAccountKey("AliceExample"))
    return { provider: "zoom", list: catalogList }
  })
  deps.recordings = { list, show: async () => meeting, download, catalog }
  const checkpoint = join(directory, "checkpoint.json")
  const args = [
    "recordings",
    "download",
    "--since-time",
    "2026-10-01",
    "--until-time",
    "2026-10-11",
    "--output-dir",
    directory,
    "--checkpoint",
    checkpoint,
    "--recheck-since-time",
    "2026-10-04",
    "--max-pages",
    "2",
    "--max-entries",
    "1",
    "--max-bytes",
    "1024",
    "--jsonl",
  ]
  expect(await run(args, deps)).toBe(0)
  expect(list).not.toHaveBeenCalled()
  expect(catalogList).toHaveBeenLastCalledWith(
    expect.objectContaining({ account: profileAccountKey("AliceExample"), cursor: "example-page" }),
  )
  expect(download).toHaveBeenCalledWith(
    meeting.uuid,
    expect.objectContaining({ resume: true, account: profileAccountKey("AliceExample"), maxBytes: 1024 }),
  )
  expect(readReceipt(output.at(-1) ?? "{}")).toMatchObject({
    availability: "unknown",
    checkpoint_revision: expect.any(Number),
  })
  const saved = JSON.parse(await readFile(checkpoint, "utf8"))
  expect(saved.scope).toEqual({ provider: "zoom", account: profileAccountKey("AliceExample") })
  expect(JSON.stringify(saved)).not.toMatch(/accessToken|refreshToken|downloadUrl/)
})

it("prevalidates bounds, dates, selections and resume conflicts before provider work", async () => {
  const { deps, directory, download, list, tokenAccess } = await setup()
  useProfile(deps.configPath, "AliceExample")
  const sync = [
    "recordings",
    "download",
    "--since-time",
    "2026-10-01",
    "--until-time",
    "2026-10-11",
    "--output-dir",
    directory,
    "--jsonl",
  ]
  for (const flags of [
    ["--max-pages", "10001"],
    ["--max-entries", "0"],
    ["--max-entries", "10001"],
    ["--recheck-since-time", "2026-02-30"],
    ["--checkpoint", " "],
    ["--checkpoint", "example.json", "--no-resume"],
  ])
    expect(await run([...sync, ...flags], deps)).toBe(2)
  expect(
    await run(
      [
        "recordings",
        "download",
        "--since-time",
        "2026-02-30",
        "--until-time",
        "2026-10-11",
        "--output-dir",
        directory,
        "--jsonl",
      ],
      deps,
    ),
  ).toBe(2)
  expect(await run(["recordings", "download", meeting.uuid, "--output-dir", directory, "--file-ids", " "], deps)).toBe(
    2,
  )
  expect(download).not.toHaveBeenCalled()
  expect(list).not.toHaveBeenCalled()
  expect(tokenAccess).not.toHaveBeenCalled()
})

it("refuses saved backup jobs after profile or client changes before keyring or network access", async () => {
  const { deps, directory, output, errors } = await setup()
  useProfile(deps.configPath, "AliceExample")
  const schedule = planRecordingArchiveSchedule(
    {
      name: "Alice Example backup",
      scope: { provider: "zoom", account: profileAccountKey("AliceExample") },
      destination: join(directory, "archive"),
      from: "2026-10-01",
      dailyAt: "03:00",
      timeZone: "Europe/Madrid",
    },
    { now: Date.parse("2026-10-11T00:00:00Z") },
  )
  await fileRecordingScheduleStore(join(directory, "recording-schedules")).save(
    {
      version: 1,
      schedule,
      state: "enabled",
      capture: {
        profile: "AliceExample",
        clientId: "example-client",
        configDir: directory,
        runtime: process.execPath,
        cliPath: join(directory, "example-cli.js"),
      },
    },
    {},
  )
  const keyring = vi.spyOn(deps.tokens.options.keyring, "get")
  const network = vi.fn(async (): Promise<Response> => {
    throw new Error("unexpected network")
  })
  deps.fetch = network
  for (const [profile, clientId] of [
    ["BobSample", "example-client"],
    ["AliceExample", "other-example-client"],
  ] as const) {
    useProfile(deps.configPath, profile)
    setConfig(deps.configPath, "zoom.client_id", clientId)
    expect(await run(["recordings", "schedule", "run", schedule.id, "--jsonl"], deps)).toBe(3)
    expect(JSON.parse(errors.at(-1) ?? "{}").error.message).toMatch(/saved profile.*client/)
  }
  expect(keyring).not.toHaveBeenCalled()
  expect(network).not.toHaveBeenCalled()
  expect(output).toEqual([])
  await expect(access(schedule.destination)).rejects.toMatchObject({ code: "ENOENT" })
  useProfile(deps.configPath, "AliceExample")
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  deps.tokens.options.keyring.set(
    `zoom-cli:${directory}`,
    "example-client:AliceExample",
    JSON.stringify({
      accessToken: "example-scheduled-access",
      refreshToken: "example-scheduled-refresh",
      expiresAt: Date.parse("2026-10-12T00:00:00Z"),
      scopes: ["cloud_recording:read:list_user_recordings"],
    }),
  )
  network.mockImplementation(async () => new Response(JSON.stringify({ meetings: [], next_page_token: "" })))
  expect(await run(["recordings", "schedule", "run", schedule.id, "--jsonl"], deps)).toBe(0)
  expect(keyring).toHaveBeenCalledWith(`zoom-cli:${directory}`, "example-client:AliceExample")
  expect(network).toHaveBeenCalledTimes(1)
  const saved = JSON.parse(await readFile(join(schedule.destination, ".zoom-archive-sync.json"), "utf8"))
  expect(saved.scope).toEqual({ provider: "zoom", account: profileAccountKey("AliceExample") })
})

it("previews native schedules offline without persisting jobs, units or opening credentials", async () => {
  const { deps, directory, output, tokenAccess } = await setup()
  deps.recordingScheduleTarget = { runtime: process.execPath, cliPath: join(directory, "example-cli.js") }
  deps.env = { HOME: directory, XDG_CONFIG_HOME: join(directory, "config-home") }
  useProfile(deps.configPath, "AliceExample", deps.env)
  expect(
    await run(
      [
        "recordings",
        "schedule",
        "create",
        "--name",
        "Alice Example backup",
        "--output-dir",
        join(directory, "archive"),
        "--since-time",
        "2026-10-01",
        "--at",
        "03:15",
        "--timezone",
        "Europe/Madrid",
        "--lookback-days",
        "7",
        "--max-bytes",
        "1024",
        "--yes",
        "--dry-run",
        "--offline",
        "--json",
      ],
      deps,
    ),
  ).toBe(0)
  expect(readReceipt(output.at(-1) ?? "{}")).toMatchObject({
    applied: false,
    timer_state: "not_checked",
    job: { capture: { profile: "AliceExample", client_id: "example-client" } },
  })
  expect(tokenAccess).not.toHaveBeenCalled()
  await expect(access(join(directory, "recording-schedules"))).rejects.toMatchObject({ code: "ENOENT" })
  await expect(access(join(directory, "config-home", "systemd", "user"))).rejects.toMatchObject({ code: "ENOENT" })
})

it("gives scheduled archive runs a download deadline and streams completed receipts", async () => {
  const { deps, output } = await setup()
  const fail = async () => {
    throw new Error("unexpected schedule method")
  }
  deps.recordingSchedule = {
    create: fail,
    list: fail,
    show: fail,
    disable: fail,
    run: async function* () {
      yield {
        window: { from: "2026-10-01", to: "2026-10-11" },
        meeting: { id: meeting.id, uuid: meeting.uuid, title: meeting.title },
        archive: report,
      }
    },
  }
  const timers = vi.spyOn(globalThis, "setTimeout")
  expect(await run(["recordings", "schedule", "run", "a".repeat(64), "--jsonl"], deps)).toBe(0)
  expect(timers.mock.calls.some(([, ms]) => ms === 3600000)).toBe(true)
  timers.mockRestore()
  expect(output.map((text) => readReceipt(text).meeting.uuid)).toEqual([meeting.uuid])
})

it("rejects ambiguous or incomplete download selections before touching a provider or destination", async () => {
  const { deps, directory, download, catalog, tokenAccess, output } = await setup()
  useProfile(deps.configPath, "AliceExample")
  const destination = join(directory, "untouched-selection")
  for (const selection of [
    [],
    ["--since-time", "2026-10-01"],
    ["--until-time", "2026-10-11"],
    [meeting.uuid, "--since-time", "2026-10-01", "--until-time", "2026-10-11"],
    [meeting.uuid, "--checkpoint", "checkpoint.json"],
    [meeting.uuid, "--recheck-since-time", "2026-10-01"],
    [meeting.uuid, "--max-pages", "2"],
    [meeting.uuid, "--max-entries", "2"],
    [""],
    ["--since-time", "2026-10-01", "--until-time", "2026-10-11", "--file-ids", "asset"],
  ])
    expect(await run(["recordings", "download", ...selection, "--output-dir", destination, "--json"], deps)).toBe(2)
  expect(download).not.toHaveBeenCalled()
  expect(catalog).not.toHaveBeenCalled()
  expect(tokenAccess).not.toHaveBeenCalled()
  expect(output).toEqual([])
  await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" })
})

it("answers range downloads as a typed bounded JSON list, supports projection and retains empty results", async () => {
  const { deps, directory, output, download } = await setup()
  useProfile(deps.configPath, "AliceExample")
  const list = vi.fn(async () => ({ items: [{ ...meeting, externalId: meeting.uuid }], nextCursor: null }))
  deps.recordings = {
    list: async () => [meeting],
    show: async () => meeting,
    download,
    catalog: () => ({ provider: "zoom", list }),
  }
  const args = [
    "recordings",
    "download",
    "--since-time",
    "2026-10-01",
    "--until-time",
    "2026-10-11",
    "--output-dir",
    directory,
    "--no-resume",
  ]
  expect(await run([...args, "--json"], deps)).toBe(0)
  const packet = JSON.parse(output.pop() ?? "{}")
  expect(readAnswer(JSON.stringify(packet))).toMatchObject({
    items: [{ meeting: { uuid: meeting.uuid } }],
    page: { has_more: false },
  })
  expect(declaredAnswerIssue(createProgram(deps), "recordings download", packet)).toBeUndefined()
  expect(await run([...args, "--json=meeting.uuid"], deps)).toBe(0)
  expect(readAnswer(output.pop() ?? "{}").items).toEqual([{ meeting: { uuid: meeting.uuid } }])
  list.mockResolvedValueOnce({ items: [], nextCursor: null })
  expect(await run(args, deps)).toBe(0)
  expect(readAnswer(output.pop() ?? "{}")).toMatchObject({ items: [], page: { has_more: false } })
  expect(download).toHaveBeenCalledTimes(2)
})

it("stops bounded JSON collection before downloading another occurrence", async () => {
  const { deps, directory, download, output } = await setup()
  useProfile(deps.configPath, "AliceExample")
  deps.recordings = {
    list: async () => [meeting],
    show: async () => meeting,
    download,
    catalog: () => ({
      provider: "zoom",
      list: async () => ({
        items: [
          { ...meeting, externalId: meeting.uuid },
          { ...meeting, externalId: "second-occurrence" },
        ],
        nextCursor: null,
      }),
    }),
  }
  expect(
    await run(
      [
        "recordings",
        "download",
        "--since-time",
        "2026-10-01",
        "--until-time",
        "2026-10-11",
        "--output-dir",
        directory,
        "--no-resume",
        "--json",
        "--max-output-bytes",
        "100",
      ],
      deps,
    ),
  ).toBe(13)
  expect(output).toEqual([])
  expect(download).toHaveBeenCalledTimes(1)
})
