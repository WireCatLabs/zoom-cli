import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { expect, it } from "vitest"
import { RecordingPartialStore } from "./recording-partial-store.js"

const scope = {
  provider: "example-video",
  account: "AliceExample",
  occurrenceId: "example-occurrence",
  assetId: "example-video",
}
it("fresh partial creation preserves a foreign directory without leaving a temporary file", async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-partial-publication-fail-"))
  const store = new RecordingPartialStore(root, scope)
  await mkdir(store.path)
  const foreign = join(store.path, "AliceExample.txt")
  await writeFile(foreign, "invented foreign contents")
  await expect(store.open(scope, { validator: '"example-v1"', total: 3 })).rejects.toThrow()
  expect(await readFile(foreign, "utf8")).toBe("invented foreign contents")
  expect(await readdir(root)).toEqual([basename(store.path)])
})
it("rejects oversized serialized host metadata before acknowledging completion or publishing a checkpoint", async () => {
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
  expect(await readFile(store.path, "utf8")).toBe("abc")
  expect(await readdir(root)).toEqual([basename(store.path)])
  expect(await store.load(invalidHostScope)).toBeNull()
})
