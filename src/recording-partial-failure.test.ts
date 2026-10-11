import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { expect, it, vi } from "vitest"
import { RecordingPartialStore } from "./recording-partial-store.js"

const handles = vi.hoisted(() => ({ opened: 0, closed: 0 }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[1] !== "wx+" || !String(args[0]).includes(".zoom-partial-")) return handle
      handles.opened++
      return new Proxy(handle, {
        get(target, key) {
          if (key === "close")
            return async () => {
              handles.closed++
              await target.close()
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})
const scope = {
  provider: "example-video",
  account: "AliceExample",
  occurrenceId: "example-occurrence",
  assetId: "example-video",
}
it("fresh partial creation preserves a foreign directory and closes its failed temporary handle", async () => {
  handles.opened = 0
  handles.closed = 0
  const root = await mkdtemp(join(tmpdir(), "zm-test-partial-publication-fail-"))
  const store = new RecordingPartialStore(root, scope)
  await mkdir(store.path)
  const foreign = join(store.path, "AliceExample.txt")
  await writeFile(foreign, "invented foreign contents")
  await expect(store.open(scope, { validator: '"example-v1"', total: 3 })).rejects.toThrow()
  expect(handles.opened).toBe(1)
  expect(handles.closed).toBe(1)
  expect(await readFile(foreign, "utf8")).toBe("invented foreign contents")
  expect(await readdir(root)).toEqual([basename(store.path)])
})
it("rejects oversized serialized host metadata before acknowledging completion or publishing a checkpoint", async () => {
  handles.opened = 0
  handles.closed = 0
  const root = await mkdtemp(join(tmpdir(), "zm-test-partial-metadata-fail-"))
  const invalidHostScope = { ...scope, account: "AliceExample".repeat(2000) }
  const store = new RecordingPartialStore(root, invalidHostScope)
  const writer = await store.open(invalidHostScope, { validator: '"example-v1"', total: 3 })
  try {
    await writer.write(new TextEncoder().encode("abc"))
    await expect(writer.finish()).rejects.toMatchObject({ code: "validation_error" })
    expect(store.completed).toBeNull()
  } finally {
    await writer.close()
  }
  expect(handles.opened).toBe(1)
  expect(handles.closed).toBe(1)
  expect(await readFile(store.path, "utf8")).toBe("abc")
  expect(await readdir(root)).toEqual([basename(store.path)])
  expect(await store.load(invalidHostScope)).toBeNull()
})
