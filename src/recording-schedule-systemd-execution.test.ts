import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { planRecordingArchiveSchedule } from "@wirecat/cli-meetings"
import { expect, it, vi } from "vitest"
import { parseRecordingScheduleJob } from "./recording-schedule.js"
import { createSystemdRecordingArchiveScheduler } from "./recording-schedule-systemd.js"

const executor = vi.hoisted(() => ({
  calls: [] as { command: string; args: string[]; options: { shell?: boolean; timeout?: number } }[],
  error: null as null | { code?: number | string },
  disabled: false,
}))
vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: string[],
    options: { shell?: boolean; timeout?: number },
    done: (error: null | { code?: number | string }) => void,
  ) => {
    executor.calls.push({ command, args, options })
    if (executor.error) return queueMicrotask(() => done(executor.error))
    if (args.includes("disable")) executor.disabled = true
    const code =
      executor.disabled && args.includes("is-enabled") ? 1 : executor.disabled && args.includes("is-active") ? 3 : 0
    queueMicrotask(() => done(code === 0 ? null : { code }))
  },
}))
const fixture = async () => {
  executor.calls = []
  executor.error = null
  executor.disabled = false
  const root = await mkdtemp(join(tmpdir(), "zm-test-systemd-exec-"))
  const capture = {
    profile: "AliceExample",
    clientId: "example-public-client",
    configDir: root,
    runtime: process.execPath,
    cliPath: join(root, "example-cli.js"),
  }
  await writeFile(capture.cliPath, "// invented CLI")
  const job = parseRecordingScheduleJob({
    version: 1,
    capture,
    state: "pending",
    schedule: planRecordingArchiveSchedule(
      {
        name: "Alice Example archive",
        scope: { provider: "zoom", account: "zm-profile:AliceExample" },
        destination: join(root, "archive"),
        from: "2026-10-01",
        dailyAt: "03:15",
        timeZone: "UTC",
      },
      { now: Date.parse("2026-10-11T00:00:00Z") },
    ),
  })
  const backend = createSystemdRecordingArchiveScheduler({ unitDirectory: join(root, "units"), platform: "linux" })
  return { root, job, backend }
}
it("the real executor adapter supplies shell:false and bounded invocation, using a fake native execFile", async () => {
  const { job, backend } = await fixture()
  await backend.install(job, {})
  await backend.install(job, {})
  expect(executor.calls).toHaveLength(8)
  for (const call of executor.calls) {
    expect(call.command).toBe("/usr/bin/systemctl")
    expect(call.options).toMatchObject({ shell: false, timeout: 30000 })
    expect(call.args[0]).toBe("--user")
  }
  await backend.disable(job, {})
  expect(executor.calls).toHaveLength(11)
})
it.each([{ code: "ENOENT" }, { code: "ABORT_ERR" }, { code: 2 }])(
  "preserves pending installation and never retries failed native execution %j",
  async (error) => {
    const { job, backend } = await fixture()
    executor.error = error
    await expect(backend.install(job, {})).rejects.toMatchObject({
      code: error.code === "ENOENT" ? "configuration_error" : "outcome_unknown",
    })
    expect(executor.calls).toHaveLength(1)
  },
)
it("cancellation and missing/foreign runtime files prevent any native dispatch", async () => {
  const { root, job, backend } = await fixture()
  const controller = new AbortController()
  controller.abort()
  await expect(backend.install(job, { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" })
  const foreign = { ...job, capture: { ...job.capture, runtime: join(root, "not-executable") } }
  await writeFile(foreign.capture.runtime, "invented file", { mode: 0o600 })
  await expect(backend.install(foreign, {})).rejects.toThrow("executable")
  await expect(backend.disable(job, {})).rejects.toMatchObject({ code: "not_found" })
  expect(executor.calls).toHaveLength(0)
})
it("an injected executor exception is uncertain and unit path injection is rejected", async () => {
  const { root, job } = await fixture()
  expect(() => createSystemdRecordingArchiveScheduler({ unitDirectory: "relative" })).toThrow("absolute")
  expect(() => createSystemdRecordingArchiveScheduler({ unitDirectory: root, systemctl: "systemctl" })).toThrow(
    "absolute",
  )
  const execute = vi.fn(async () => {
    throw new Error("invented execution interruption")
  })
  const backend = createSystemdRecordingArchiveScheduler({ unitDirectory: join(root, "units"), execute })
  await expect(backend.install(job, {})).rejects.toMatchObject({ code: "outcome_unknown" })
  expect(execute).toHaveBeenCalledTimes(1)
})
