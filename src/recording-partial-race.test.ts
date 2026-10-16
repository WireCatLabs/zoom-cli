import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { RecordingPartialStore } from "./recording-partial-store.js"

it("refuses a same-content replacement after opening the resumable writer", async () => {
  const locator = { provider: "example-video", account: "AliceExample", occurrenceId: "example", assetId: "video" }
  const storage = new RecordingPartialStore(await mkdtemp(join(tmpdir(), "zm-test-partial-race-")), locator)
  const seed = await storage.open(locator, { validator: '"example-v1"', total: 6 })
  try {
    await seed.write(Buffer.from("abc"))
    await seed.checkpoint()
  } finally {
    await seed.close()
  }
  const partial = await storage.load(locator)
  const writer = await storage.open(locator, { resume: partial ?? undefined, validator: '"example-v1"', total: 6 })
  try {
    await rename(storage.path, `${storage.path}.retained-original`)
    await writeFile(storage.path, "abc")
    await expect(writer.write(Buffer.from("def"))).rejects.toThrow("changed before append")
    await expect(writer.finish()).rejects.toThrow("changed before append")
    expect(storage.completed).toBeNull()
  } finally {
    await writer.close()
  }
  expect(await readFile(storage.path, "utf8")).toBe("abc")
  expect(await readFile(`${storage.path}.retained-original`, "utf8")).toBe("abc")
})
