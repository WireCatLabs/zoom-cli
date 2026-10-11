import { mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { planRecordingArchiveSchedule } from "@wirecat/cli-meetings"
import { expect, it, vi } from "vitest"
import {
  createRecordingScheduleService,
  parseRecordingScheduleJob,
  type RecordingScheduleBackend,
  type RecordingScheduleCapture,
  type RecordingScheduleJob,
  type RecordingScheduleStore,
  snapshotRecordingScheduleCapture,
} from "./recording-schedule.js"
import { fileRecordingScheduleStore } from "./recording-schedule-store.js"
import { createSystemdRecordingArchiveScheduler } from "./recording-schedule-systemd.js"

const now = () => Date.parse("2026-10-11T12:00:00.000Z")
const temp = () => mkdtemp(join(tmpdir(), "zm-test-schedule-"))
const capture = (root: string): RecordingScheduleCapture => ({
  profile: "AliceExample",
  clientId: "example-public-client",
  configDir: join(root, "config"),
  runtime: process.execPath,
  cliPath: join(root, "example-cli.js"),
})
const input = (root: string) => ({
  name: "Alice Example daily archive",
  destination: join(root, "archive"),
  from: "2026-10-01",
  dailyAt: "03:15",
  timeZone: "UTC",
})
const job = (root: string, state: RecordingScheduleJob["state"] = "pending") =>
  parseRecordingScheduleJob({
    version: 1,
    schedule: planRecordingArchiveSchedule(
      { ...input(root), scope: { provider: "zoom", account: "zm-profile:AliceExample" } },
      { now: now() },
    ),
    capture: capture(root),
    state,
  })
const memory = (): RecordingScheduleStore => {
  const jobs = new Map<string, RecordingScheduleJob>()
  return {
    list: vi.fn(async () => [...jobs.values()]),
    load: vi.fn(async (id) => jobs.get(id) ?? null),
    save: vi.fn(async (value) => {
      jobs.set(value.schedule.id, value)
    }),
  }
}
const fakeBackend = (): RecordingScheduleBackend => ({
  backend: "invented-local",
  plan: vi.fn(() => ({
    serviceName: "example.service",
    timerName: "example.timer",
    service: "invented",
    timer: "invented",
  })),
  assertSupported: vi.fn(),
  install: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
})
const service = (
  store = memory(),
  backend = fakeBackend(),
  recordings = vi.fn(() => {
    throw new Error("unexpected recording access")
  }),
) => ({ store, backend, recordings, api: createRecordingScheduleService({ store, backend, recordings, now }) })
const collect = async <T>(items: AsyncIterable<T>) => {
  const result = []
  for await (const item of items) result.push(item)
  return result
}

it("default schedule preview performs no storage, credential or executor IO", async () => {
  const root = await temp()
  const fixture = service()
  const value = capture(root)
  const result = await fixture.api.create(input(root), value, { apply: true, dryRun: true, offline: true })
  value.profile = "BobSample"
  expect(result).toMatchObject({
    applied: false,
    timerState: "not_checked",
    job: { capture: { profile: "AliceExample" }, state: "pending" },
  })
  expect(fixture.store.load).not.toHaveBeenCalled()
  expect(fixture.store.save).not.toHaveBeenCalled()
  expect(fixture.backend.install).not.toHaveBeenCalled()
  expect(fixture.recordings).not.toHaveBeenCalled()
  expect(await readdir(root)).toEqual([])
})
it("installs explicitly, preserving pending state on uncertain installation and acknowledging late cancellation", async () => {
  const root = await temp()
  const fixture = service()
  const controller = new AbortController()
  vi.mocked(fixture.backend.install).mockImplementationOnce(async () => {
    throw new Error("invented incomplete install")
  })
  await expect(fixture.api.create(input(root), capture(root), { apply: true })).rejects.toThrow("incomplete")
  expect((await fixture.api.list())[0]?.state).toBe("pending")
  vi.mocked(fixture.backend.install).mockImplementationOnce(async () => controller.abort())
  const result = await fixture.api.create(input(root), capture(root), { apply: true, signal: controller.signal })
  expect(result).toMatchObject({ applied: true, timerState: "verified_enabled", job: { state: "enabled" } })
})
it("rejects install and run offline before storage and never retargets a stored capture", async () => {
  const root = await temp()
  const fixture = service()
  await expect(fixture.api.create(input(root), capture(root), { apply: true, offline: true })).rejects.toThrow("online")
  await expect(collect(fixture.api.run("a".repeat(64), { offline: true }))).rejects.toThrow("online")
  expect(fixture.store.load).not.toHaveBeenCalled()
  await fixture.api.create(input(root), capture(root), { apply: true })
  await expect(
    fixture.api.create(input(root), { ...capture(root), clientId: "other-public-client" }, { apply: true }),
  ).rejects.toThrow("different captured")
})
it("reads and disables captured metadata without a current account or credentials", async () => {
  const root = await temp()
  const fixture = service()
  const created = await fixture.api.create(input(root), capture(root), { apply: true })
  expect(await fixture.api.show(created.job.schedule.id)).toMatchObject({ state: "enabled" })
  expect(await fixture.api.disable(created.job.schedule.id, { apply: true, dryRun: true })).toMatchObject({
    applied: false,
    timerState: "not_checked",
  })
  expect(fixture.backend.disable).not.toHaveBeenCalled()
  expect(await fixture.api.disable(created.job.schedule.id, { apply: true })).toMatchObject({
    applied: true,
    timerState: "verified_disabled",
    job: { state: "disabled" },
  })
  expect(fixture.recordings).not.toHaveBeenCalled()
  await expect(fixture.api.show("b".repeat(64))).rejects.toMatchObject({ code: "not_found" })
  await expect(fixture.api.show("../example")).rejects.toMatchObject({ code: "validation_error" })
})
it("delegates one manual run to durable shared synchronization with captured scope and UTC lookback", async () => {
  const root = await temp()
  const store = memory()
  const saved = job(root, "disabled")
  await store.save(saved, {})
  const recordings = vi.fn((value: RecordingScheduleJob) => {
    expect(value.capture.profile).toBe("AliceExample")
    expect(value.capture.clientId).toBe("example-public-client")
    return {
      list: async (range: { from: string; to: string }) => {
        expect(range).toMatchObject({ from: "2026-10-01", to: "2026-10-11" })
        return [
          { id: "123456", uuid: "example-occurrence", title: "Alice Example planning", startedAt: null, assets: [] },
        ]
      },
      download: async () => ({
        uuid: "example-occurrence",
        manifestPath: join(root, "manifest.json"),
        downloaded: [],
        skipped: [],
        unavailable: [],
      }),
    }
  })
  const api = createRecordingScheduleService({ store, backend: fakeBackend(), recordings, now })
  expect(await collect(api.run(saved.schedule.id))).toHaveLength(1)
  expect(recordings).toHaveBeenCalledTimes(1)
  expect(await readdir(saved.schedule.destination)).toContain(".zoom-archive-sync.json")
})
it("a future job performs no provider or archive IO and saved-id mismatch is rejected", async () => {
  const root = await temp()
  const fixture = service()
  const future = await fixture.api.create({ ...input(root), from: "2027-01-01" }, capture(root), { apply: true })
  expect(await collect(fixture.api.run(future.job.schedule.id))).toEqual([])
  expect(fixture.recordings).not.toHaveBeenCalled()
  vi.mocked(fixture.store.load).mockResolvedValueOnce(future.job)
  await expect(fixture.api.show("a".repeat(64))).rejects.toThrow("different job")
})
it("validates captures and job metadata before trusting executable arguments", async () => {
  const root = await temp()
  for (const value of [
    { ...capture(root), profile: "../Alice" },
    { ...capture(root), clientId: "example secret" },
    { ...capture(root), runtime: "node" },
    { ...capture(root), cliPath: "bad\npath" },
  ])
    expect(() => snapshotRecordingScheduleCapture(value)).toThrow()
  expect(() => parseRecordingScheduleJob({ ...job(root), token: "example" })).toThrow()
  expect(() => parseRecordingScheduleJob({ ...job(root), capture: { ...capture(root), token: "example" } })).toThrow()
  expect(() =>
    parseRecordingScheduleJob({ ...job(root), capture: { ...capture(root), profile: "BobSample" } }),
  ).toThrow("scope")
  expect(() => parseRecordingScheduleJob(null)).toThrow()
})
it("persists ordinary bounded owned jobs across reopen and preserves foreign or symlinked files", async () => {
  const root = await temp()
  const directory = join(root, "jobs")
  const store = fileRecordingScheduleStore(directory)
  const saved = job(root)
  expect(await store.list({})).toEqual([])
  expect(await store.load(saved.schedule.id, {})).toBeNull()
  await store.save(saved, {})
  const path = join(directory, `${saved.schedule.id}.json`)
  if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600)
  expect(await fileRecordingScheduleStore(directory).load(saved.schedule.id, {})).toEqual(saved)
  await store.save({ ...saved, state: "enabled" }, {})
  expect((await store.list({}))[0]?.state).toBe("enabled")
  const content = await readFile(path, "utf8")
  expect(content).not.toMatch(/accessToken|refreshToken|password|signature/)
  await writeFile(path, "foreign example content")
  await expect(store.save(saved, {})).rejects.toThrow("invalid")
  expect(await readFile(path, "utf8")).toBe("foreign example content")
  if (process.platform === "win32") return
  const other = await temp()
  await symlink(directory, join(other, "jobs"))
  await expect(fileRecordingScheduleStore(join(other, "jobs")).load(saved.schedule.id, {})).rejects.toThrow("symlinks")
})
it("bounds native metadata and verifies filenames before exposing a saved job", async () => {
  const root = await temp()
  const directory = join(root, "jobs")
  const store = fileRecordingScheduleStore(directory)
  const saved = job(root)
  await store.save(saved, {})
  const path = join(directory, `${saved.schedule.id}.json`)
  await writeFile(path, "x".repeat(32 * 1024 + 1))
  await expect(store.load(saved.schedule.id, {})).rejects.toThrow("byte limit")
  await writeFile(path, JSON.stringify(job(root, "enabled")))
  await writeFile(join(directory, `${"b".repeat(64)}.json`), JSON.stringify(saved))
  await expect(store.list({})).rejects.toThrow("filename")
})
it("renders escaped systemd argv without shell evaluation and verifies install/disable states with a fake executor", async () => {
  const root = await temp()
  const saved = job(root)
  await writeFile(saved.capture.cliPath, "// invented CLI")
  const execute = vi.fn(async (_: string, args: readonly string[]) => ({
    exitCode: args[1] === "is-enabled" && args.includes(saved.schedule.id) ? 1 : 0,
  }))
  const backend = createSystemdRecordingArchiveScheduler({
    unitDirectory: join(root, "units"),
    execute,
    platform: "linux",
  })
  const units = backend.plan(saved)
  expect(await readdir(root)).toEqual(["example-cli.js"])
  expect(units.service).toContain('"--timeout" "6h"')
  expect(units.timer).toContain("OnCalendar=*-*-* 03:15:00 UTC")
  await backend.install(saved, {})
  expect(execute.mock.calls.map(([, args]) => args[1])).toEqual(["daemon-reload", "enable", "is-enabled", "is-active"])
  for (const call of execute.mock.calls) expect(call[0]).toBe("/usr/bin/systemctl")
  execute.mockImplementation(async (_, args) => ({
    exitCode: args[1] === "is-enabled" ? 1 : args[1] === "is-active" ? 3 : 0,
  }))
  await backend.disable(saved, {})
  expect(await readFile(join(root, "units", units.serviceName), "utf8")).toBe(units.service)
  expect(await readFile(join(root, "units", units.timerName), "utf8")).toBe(units.timer)
})
it("escapes config/runtime target percent, dollar, quotes and spaces in the unit text", async () => {
  const root = await temp()
  const saved = {
    ...job(root),
    capture: {
      ...capture(root),
      configDir: join(root, 'Alice "Example" $%'),
      runtime: join(root, "node $%"),
      cliPath: join(root, 'cli "Example".js'),
    },
  }
  const backend = createSystemdRecordingArchiveScheduler({
    unitDirectory: join(root, "units"),
    execute: async () => ({ exitCode: 0 }),
  })
  const units = backend.plan(saved)
  expect(units.service).toContain('node $$%%"')
  expect(units.service).toContain('Alice \\"Example\\" $%%')
})
it("rejects unsupported platforms, edited units and uncertain backend verification without claiming success", async () => {
  const root = await temp()
  const saved = job(root)
  const unsupported = createSystemdRecordingArchiveScheduler({
    unitDirectory: join(root, "units"),
    platform: "darwin",
    execute: async () => ({ exitCode: 0 }),
  })
  await expect(unsupported.install(saved, {})).rejects.toThrow("Linux")
  expect(await readdir(root)).toEqual([])
  await writeFile(saved.capture.cliPath, "// invented CLI")
  const backend = createSystemdRecordingArchiveScheduler({
    unitDirectory: join(root, "units"),
    platform: "linux",
    execute: async () => ({ exitCode: 1 }),
  })
  await expect(backend.install(saved, {})).rejects.toMatchObject({ code: "outcome_unknown" })
  const units = backend.plan(saved)
  await writeFile(join(root, "units", units.timerName), "foreign timer example")
  await expect(backend.install(saved, {})).rejects.toThrow("foreign")
  await expect(backend.disable(saved, {})).rejects.toThrow("foreign")
  expect(await readFile(join(root, "units", units.timerName), "utf8")).toBe("foreign timer example")
})

it("rejects missing captures, traversal, scope mutations and oversized escaped metadata before saving", async () => {
  const root = await temp()
  const fixture = service()
  expect(() => snapshotRecordingScheduleCapture(null as unknown as RecordingScheduleCapture)).toThrow("invalid")
  expect(() => snapshotRecordingScheduleCapture(undefined as unknown as RecordingScheduleCapture)).toThrow("invalid")
  expect(() => parseRecordingScheduleJob({ ...job(root), state: "foreign" })).toThrow("invalid")
  const large = `/${"\u0001".repeat(4000)}`
  await expect(
    fixture.api.create(
      { ...input(root), destination: large },
      {
        ...capture(root),
        configDir: `/${"a".repeat(4000)}`,
        runtime: `/${"b".repeat(4000)}`,
        cliPath: `/${"c".repeat(4000)}`,
      },
      { apply: true },
    ),
  ).rejects.toThrow("byte limit")
  expect(fixture.store.save).not.toHaveBeenCalled()
})
it("native storage rejects captured-client collisions, corrupt filenames and non-directory ancestry without replacing files", async () => {
  const root = await temp()
  const directory = join(root, "jobs")
  const store = fileRecordingScheduleStore(directory)
  const saved = job(root)
  await store.save(saved, {})
  const path = join(directory, `${saved.schedule.id}.json`)
  const before = await readFile(path, "utf8")
  await expect(
    store.save({ ...saved, capture: { ...saved.capture, clientId: "another-public-client" } }, {}),
  ).rejects.toThrow("another captured")
  expect(await readFile(path, "utf8")).toBe(before)
  await writeFile(join(directory, `${"b".repeat(64)}.json`), before)
  await expect(store.load("b".repeat(64), {})).rejects.toThrow("filename")
  await writeFile(join(root, "foreign-file"), "invented foreign contents")
  await expect(fileRecordingScheduleStore(join(root, "foreign-file", "jobs")).save(saved, {})).rejects.toThrow(
    "foreign files",
  )
  await expect(fileRecordingScheduleStore("relative").list({})).rejects.toThrow("absolute")
})
it("refuses saved-job symlinks, truncated records and cancelled native writes", async () => {
  const root = await temp()
  const directory = join(root, "jobs")
  const store = fileRecordingScheduleStore(directory)
  const saved = job(root)
  const controller = new AbortController()
  controller.abort()
  await expect(store.save(saved, { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" })
  expect(await readdir(root)).toEqual([])
  await store.save(saved, {})
  const path = join(directory, `${saved.schedule.id}.json`)
  await writeFile(path, "{")
  await expect(store.load(saved.schedule.id, {})).rejects.toThrow("invalid")
  if (process.platform === "win32") return
  const other = await temp()
  await symlink(path, join(other, `${saved.schedule.id}.json`))
  await expect(fileRecordingScheduleStore(other).save(saved, {})).rejects.toThrow("symlink")
})

it("two independent job writers safely share newly created metadata directories", async () => {
  const root = await temp()
  const directory = join(root, "new-parent", "jobs")
  const first = job(root)
  const second = {
    ...first,
    schedule: planRecordingArchiveSchedule(
      { ...input(root), name: "Bob Sample archive", scope: first.schedule.scope },
      { now: now() },
    ),
  }
  await Promise.all([
    fileRecordingScheduleStore(directory).save(first, {}),
    fileRecordingScheduleStore(directory).save(second, {}),
  ])
  expect(await fileRecordingScheduleStore(directory).list({})).toHaveLength(2)
})
it("bounds preexisting systemd units and refuses symlinked units before native dispatch", async () => {
  const root = await temp()
  const saved = job(root)
  await writeFile(saved.capture.cliPath, "// invented CLI")
  const execute = vi.fn(async () => ({ exitCode: 0 }))
  const backend = createSystemdRecordingArchiveScheduler({
    unitDirectory: join(root, "units"),
    platform: "linux",
    execute,
  })
  await backend.install(saved, {})
  const units = backend.plan(saved)
  const path = join(root, "units", units.timerName)
  await writeFile(path, "x".repeat(64 * 1024 + 1))
  await expect(backend.install(saved, {})).rejects.toThrow("byte limit")
  if (process.platform === "win32") return
  const other = await temp()
  const target = join(root, "units", units.serviceName)
  await symlink(target, join(other, units.serviceName))
  const refused = createSystemdRecordingArchiveScheduler({ unitDirectory: other, platform: "linux", execute })
  const before = execute.mock.calls.length
  await expect(refused.install(saved, {})).rejects.toThrow("symlink")
  expect(execute).toHaveBeenCalledTimes(before)
})
