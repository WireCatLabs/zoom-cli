import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { writeExportFile } from "./output-file.js"

const faults = vi.hoisted(() => ({ directory: "", close: false, unlink: false }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (!String(args[0]).startsWith(faults.directory)) return handle
      return new Proxy(handle, {
        get(target, key) {
          if (key === "close")
            return async () => {
              await target.close()
              if (faults.close) throw new Error("invented close failure")
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
    unlink: async (...args: Parameters<typeof fs.unlink>) => {
      if (String(args[0]).startsWith(faults.directory) && faults.unlink) throw new Error("invented cleanup failure")
      return fs.unlink(...args)
    },
  }
})

it.each(["close", "unlink"] as const)(
  "retains the published export and refuses success after a %s failure",
  async (fault) => {
    faults.directory = await mkdtemp(join(tmpdir(), "zm-test-export-failure-"))
    const destination = join(faults.directory, "AliceExample.txt")
    faults[fault] = true
    try {
      await expect(writeExportFile(destination, "Alice Example: invented export")).rejects.toMatchObject({
        code: "configuration_error",
      })
      expect(await readFile(destination, "utf8")).toBe("Alice Example: invented export")
      expect((await readdir(faults.directory)).filter((name) => name.endsWith(".part"))).toHaveLength(
        fault === "unlink" ? 1 : 0,
      )
    } finally {
      faults.close = false
      faults.unlink = false
    }
    await expect(writeExportFile(destination, "Bob Sample: replacement")).rejects.toMatchObject({
      code: "validation_error",
    })
    expect(await readFile(destination, "utf8")).toBe("Alice Example: invented export")
  },
)
