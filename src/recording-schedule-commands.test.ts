import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-core"
import { planRecordingArchiveSchedule } from "@wirecat/cli-meetings"
import { Command } from "commander"
import { expect, it, vi } from "vitest"
import { setConfig } from "./config.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import type { RecordingScheduleJob, RecordingScheduleService } from "./recording-schedule.js"
import { addRecordingScheduleCommands } from "./recording-schedule-commands.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-schedule-commands-"))
  const now = Date.parse("2026-10-11T00:00:00.000Z")
  const capture = {
    profile: "AliceExample",
    clientId: "example-client",
    configDir: root,
    runtime: process.execPath,
    cliPath: join(root, "example-cli.js"),
  }
  const job: RecordingScheduleJob = {
    version: 1,
    schedule: planRecordingArchiveSchedule(
      {
        name: "Alice Example archive",
        scope: { provider: "zoom", account: "zm-profile:AliceExample" },
        destination: join(root, "archive"),
        from: "2026-10-01",
        dailyAt: "03:15",
        timeZone: "UTC",
      },
      { now },
    ),
    capture,
    state: "enabled",
  }
  const result = { applied: false, backend: "invented-local", job, timerState: "not_checked" as const }
  const service: RecordingScheduleService = {
    create: vi.fn(async () => result),
    list: vi.fn(async () => [job]),
    show: vi.fn(async () => job),
    run: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    disable: vi.fn(async () => result),
  }
  const output: string[] = []
  const errors: string[] = []
  const fail: typeof fetch = vi.fn(async () => {
    throw new Error("unexpected remote access")
  })
  const tokens = new TokenManager({
    clientId: "example-client",
    service: "invented",
    keyring: memoryKeyring(),
    fetch: fail,
  })
  const tokenAccess = vi.spyOn(tokens, "withSignal")
  const deps: ProgramDeps = {
    configPath: join(root, "missing-config.json"),
    recordings: {
      list: async () => [],
      show: async () => {
        throw new Error("unexpected provider")
      },
      download: async () => {
        throw new Error("unexpected provider")
      },
    },
    tokens,
    fetch: fail,
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
    recordingSchedule: service,
  }
  return { root, job, service, deps, output, errors, fail, tokenAccess }
}
it("list/show and disable previews work offline without current configuration, keyring or Zoom", async () => {
  const fixture = await setup()
  const id = fixture.job.schedule.id
  expect(await run(["recordings", "schedule", "list", "--offline", "--json"], fixture.deps)).toBe(0)
  expect(await run(["recordings", "schedule", "show", id, "--offline", "--json"], fixture.deps)).toBe(0)
  expect(
    await run(["recordings", "schedule", "disable", id, "--yes", "--dry-run", "--offline", "--json"], fixture.deps),
  ).toBe(0)
  expect(fixture.service.disable).toHaveBeenCalledWith(id, expect.objectContaining({ apply: true, dryRun: true }))
  expect(await run(["recordings", "schedule", "disable", id, "--yes", "--json"], fixture.deps)).toBe(0)
  expect(fixture.service.disable).toHaveBeenLastCalledWith(
    id,
    expect.objectContaining({ apply: true, dryRun: undefined }),
  )
  expect(fixture.fail).not.toHaveBeenCalled()
  expect(fixture.tokenAccess).not.toHaveBeenCalled()
})
it("headless run requires receipt output before obtaining a scheduler service", async () => {
  const fixture = await setup()
  expect(await run(["recordings", "schedule", "run", fixture.job.schedule.id, "--json"], fixture.deps)).toBe(2)
  expect(fixture.service.run).not.toHaveBeenCalled()
  expect(fixture.output).toEqual([])
  expect(fixture.errors.join(" ")).toMatch(/jsonl/)
  expect(await run(["recordings", "schedule", "run", fixture.job.schedule.id, "--jsonl"], fixture.deps)).toBe(0)
  expect(fixture.service.run).toHaveBeenCalledExactlyOnceWith(
    fixture.job.schedule.id,
    expect.objectContaining({ offline: false }),
  )
})
it("CLI discovery never obtains scheduling capture or service, and missing capture fails before service", async () => {
  const fixture = await setup()
  const creation = vi.spyOn(fixture.service, "create")
  const program = createProgram(fixture.deps)
  expect(program.commands.some((command) => command.name() === "recordings")).toBe(true)
  expect(creation).not.toHaveBeenCalled()
  expect(
    await run(
      [
        "recordings",
        "schedule",
        "create",
        "--name",
        "daily",
        "--destination",
        join(fixture.root, "archive"),
        "--from",
        "2026-10-01",
        "--at",
        "03:15",
        "--timezone",
        "UTC",
        "--json",
      ],
      fixture.deps,
    ),
  ).toBe(3)
  expect(creation).not.toHaveBeenCalled()
  expect(fixture.tokenAccess).not.toHaveBeenCalled()
})
it("the modular command hook streams only acknowledged service receipts and rejects a missing host group", async () => {
  const fixture = await setup()
  const deps = {
    service: () => fixture.service,
    capture: () => fixture.job.capture,
    offline: () => false,
    signal: () => undefined,
    output: vi.fn(),
    receipt: vi.fn(async () => {}),
    outputIsTTY: false,
  }
  expect(() => addRecordingScheduleCommands(new Command("zm"), deps)).toThrow("group")
  const root = new Command("zm").option("--jsonl")
  root.command("recordings")
  addRecordingScheduleCommands(root, deps)
  const receipt = {
    window: { from: "2026-10-01", to: "2026-10-11" },
    meeting: { id: "123456", uuid: "example", title: "Alice Example planning" },
    archive: { uuid: "example", manifestPath: "example.json", downloaded: [], skipped: [], unavailable: [] },
  }
  vi.mocked(fixture.service.run).mockImplementationOnce(() => ({
    async *[Symbol.asyncIterator]() {
      yield receipt
    },
  }))
  await root.parseAsync(["recordings", "schedule", "run", fixture.job.schedule.id, "--jsonl"], { from: "user" })
  expect(deps.receipt).toHaveBeenCalledExactlyOnceWith(receipt)
})

it("offline installation and manual run fail before an injected service can dispatch side effects", async () => {
  const fixture = await setup()
  expect(
    await run(["recordings", "schedule", "run", fixture.job.schedule.id, "--offline", "--jsonl"], fixture.deps),
  ).toBe(3)
  expect(fixture.service.run).not.toHaveBeenCalled()
  expect(
    await run(
      [
        "recordings",
        "schedule",
        "create",
        "--name",
        "daily",
        "--destination",
        join(fixture.root, "archive"),
        "--from",
        "2026-10-01",
        "--at",
        "03:15",
        "--timezone",
        "UTC",
        "--yes",
        "--offline",
        "--json",
      ],
      fixture.deps,
    ),
  ).toBe(3)
  expect(fixture.service.create).not.toHaveBeenCalled()
})

it.each(["create", "disable"] as const)(
  "preserves the confirmed %s acknowledgement after caller cancellation without duplicate dispatch",
  async (action) => {
    const fixture = await setup()
    const controller = new AbortController()
    fixture.deps.signal = controller.signal
    fixture.deps.recordingScheduleTarget = {
      runtime: fixture.job.capture.runtime,
      cliPath: fixture.job.capture.cliPath,
    }
    setConfig(fixture.deps.configPath, "zoom.clientId", "example-client")
    setConfig(fixture.deps.configPath, "account.profile", "AliceExample")
    const committed = {
      applied: true,
      backend: "invented-local",
      job: { ...fixture.job, state: action === "create" ? ("enabled" as const) : ("disabled" as const) },
      timerState: action === "create" ? ("verified_enabled" as const) : ("verified_disabled" as const),
    }
    vi.mocked(fixture.service[action]).mockImplementationOnce(async () => {
      controller.abort()
      return committed
    })
    const streamData = vi.fn(async (text: string, signal?: AbortSignal) => {
      expect(signal?.aborted).toBe(false)
      fixture.output.push(text)
    })
    fixture.deps.streamData = streamData
    const args =
      action === "create"
        ? [
            "recordings",
            "schedule",
            "create",
            "--name",
            "daily",
            "--destination",
            fixture.job.schedule.destination,
            "--from",
            "2026-10-01",
            "--at",
            "03:15",
            "--timezone",
            "UTC",
            "--yes",
            "--json",
            "--no-input",
          ]
        : ["recordings", "schedule", "disable", fixture.job.schedule.id, "--yes", "--json", "--no-input"]
    expect(await run(args, fixture.deps)).toBe(130)
    expect(fixture.service[action]).toHaveBeenCalledTimes(1)
    expect(streamData).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fixture.output.join(""))).toMatchObject({
      applied: true,
      timerState: committed.timerState,
      job: { state: committed.job.state },
    })
    expect(fixture.fail).not.toHaveBeenCalled()
    expect(fixture.tokenAccess).not.toHaveBeenCalled()
  },
)
