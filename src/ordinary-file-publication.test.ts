import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { syncDirectory } from "./ordinary-file.js"

const publication = vi.hoisted(() => ({ path: "", synced: 0, closed: 0, fail: false }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[0] !== publication.path) return handle
      return new Proxy(handle, {
        get(target, key) {
          if (key === "sync")
            return async () => {
              publication.synced++
              if (publication.fail) throw new Error("invented publication failure")
              await target.sync()
            }
          if (key === "close")
            return async () => {
              publication.closed++
              await target.close()
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})
it("persists published POSIX directory entries before acknowledging durability", async () => {
  publication.path = await mkdtemp(join(tmpdir(), "zm-test-publication-"))
  publication.synced = 0
  publication.closed = 0
  await syncDirectory(publication.path)
  expect(publication.synced).toBe(process.platform === "win32" ? 0 : 1)
  expect(publication.closed).toBe(process.platform === "win32" ? 0 : 1)
})
it("propagates a failed directory sync and closes its handle without a success acknowledgement", async () => {
  if (process.platform === "win32") return
  publication.path = await mkdtemp(join(tmpdir(), "zm-test-publication-failed-"))
  publication.synced = 0
  publication.closed = 0
  publication.fail = true
  try {
    await expect(syncDirectory(publication.path)).rejects.toThrow("publication failure")
    expect(publication.closed).toBe(1)
  } finally {
    publication.fail = false
  }
})
