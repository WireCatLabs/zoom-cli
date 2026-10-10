import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { openOrdinaryFile } from "./ordinary-file.js"

const hooks = vi.hoisted(() => ({ path: "", opens: 0, replace: false }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    lstat: async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await fs.lstat(...args)
      if (args[0] === hooks.path) Object.defineProperty(stat, "dev", { value: 0n })
      return stat
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === hooks.path && ++hooks.opens === 2 && hooks.replace) {
        await fs.rename(hooks.path, `${hooks.path}.original`)
        await fs.writeFile(hooks.path, "Bob Sample: replacement must not be read")
      }
      return fs.open(...args)
    },
  }
})

it("validates real handles when Windows path metadata omits the volume identity", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")
  if (!platform) throw new Error("process platform descriptor missing")
  const folder = await mkdtemp(join(tmpdir(), "zm-test-windows-path-stat-"))
  hooks.path = join(folder, "example.txt")
  hooks.opens = 0
  hooks.replace = false
  await writeFile(hooks.path, "Alice Example: invented archive")
  Object.defineProperty(process, "platform", { value: "win32" })
  try {
    const file = await openOrdinaryFile(hooks.path)
    try {
      expect(await file.readFile("utf8")).toBe("Alice Example: invented archive")
    } finally {
      await file.close()
    }
    expect(hooks.opens).toBe(2)
    hooks.opens = 0
    hooks.replace = true
    await expect(openOrdinaryFile(hooks.path)).rejects.toMatchObject({ code: "validation_error" })
    expect(await readFile(`${hooks.path}.original`, "utf8")).toBe("Alice Example: invented archive")
    await rename(hooks.path, `${hooks.path}.replacement`)
  } finally {
    Object.defineProperty(process, "platform", platform)
    hooks.path = ""
    hooks.replace = false
  }
})
