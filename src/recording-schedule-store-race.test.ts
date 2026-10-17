import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { planRecordingArchiveSchedule } from "@wirecat/cli-core/meetings"
import { expect, it, vi } from "vitest"
import { parseRecordingScheduleJob } from "./recording-schedule.js"
import { fileRecordingScheduleStore } from "./recording-schedule-store.js"

const race = vi.hoisted(() => ({ path: "", mode: "" as "" | "replace" | "grow", happened: false }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      if (race.mode === "replace" && String(args[0]).endsWith(".tmp")) {
        race.mode = ""
        await fs.rename(race.path, `${race.path}.retained-original`)
        await fs.writeFile(race.path, "foreign invented replacement")
        race.happened = true
      }
      const handle = await fs.open(...args)
      if (race.mode !== "grow" || args[0] !== race.path) return handle
      return new Proxy(handle, {
        get(target, key) {
          if (key === "read")
            return async (...params: Parameters<typeof handle.read>) => {
              race.mode = ""
              await fs.appendFile(race.path, "x".repeat(32 * 1024 + 1))
              race.happened = true
              return target.read(...params)
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-schedule-race-"))
  const job = parseRecordingScheduleJob({
    version: 1,
    state: "pending",
    capture: {
      profile: "AliceExample",
      clientId: "example-client",
      configDir: root,
      runtime: process.execPath,
      cliPath: join(root, "cli.js"),
    },
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
  const store = fileRecordingScheduleStore(join(root, "jobs"))
  await store.save(job, {})
  race.path = join(root, "jobs", `${job.schedule.id}.json`)
  race.happened = false
  return { root, job, store }
}
it("preserves a foreign replacement that appears between saved-job read and atomic publication", async () => {
  const { job, store } = await fixture()
  race.mode = "replace"
  try {
    await expect(store.save({ ...job, state: "enabled" }, {})).rejects.toThrow("changed before replacement")
    expect(race.happened).toBe(true)
    expect(await readFile(race.path, "utf8")).toBe("foreign invented replacement")
  } finally {
    race.mode = ""
  }
})
it("rejects a metadata file that grows after its size preflight", async () => {
  const { job, store } = await fixture()
  race.mode = "grow"
  try {
    await expect(store.load(job.schedule.id, {})).rejects.toThrow("byte limit")
    expect(race.happened).toBe(true)
  } finally {
    race.mode = ""
  }
})
