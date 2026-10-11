import { constants } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { RecordingPartialStore } from "./recording-partial-store.js"

const guard = vi.hoisted(() => ({ path: "", raced: false, closed: 0 }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const race = args[0] === guard.path && typeof args[1] === "number" && (args[1] & constants.O_RDWR) !== 0
      if (race) {
        await fs.rename(guard.path, `${guard.path}.retained-original`)
        await fs.writeFile(guard.path, "abc")
        guard.raced = true
      }
      const file = await fs.open(...args)
      if (!race) return file
      return new Proxy(file, {
        get(target, key) {
          if (key === "close")
            return async () => {
              guard.closed++
              await target.close()
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})
it("refuses a same-content file replacement between verification and writable open", async () => {
  const locator = { provider: "example-video", account: "AliceExample", occurrenceId: "example", assetId: "video" }
  const storage = new RecordingPartialStore(await mkdtemp(join(tmpdir(), "zm-test-partial-race-")), locator)
  const writer = await storage.open(locator, { validator: '"example-v1"', total: 6 })
  try {
    await writer.write(new TextEncoder().encode("abc"))
    await writer.checkpoint()
  } finally {
    await writer.close()
  }
  const partial = await storage.load(locator)
  guard.path = storage.path
  try {
    await expect(
      storage.open(locator, { resume: partial ?? undefined, validator: '"example-v1"', total: 6 }),
    ).rejects.toThrow("changed while opening")
    expect(guard.raced).toBe(true)
    expect(guard.closed).toBe(1)
  } finally {
    guard.path = ""
  }
})
