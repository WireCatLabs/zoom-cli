import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recordingTransferStorageContract } from "@wirecat/cli-core/meetings/testing"
import { NativeRecordingPartialStore } from "@wirecat/cli-core/persistence/native"
import { expect, it } from "vitest"
import { RecordingPartialStore } from "./recording-partial-store.js"

const locator = {
  provider: "example-video",
  account: "AliceExample",
  occurrenceId: "example-occurrence",
  assetId: "example-asset",
}
const directory = () => mkdtemp(join(tmpdir(), "zm-test-recording-partial-"))
for (const contract of recordingTransferStorageContract(async (scope) => {
  const root = await directory()
  return { storage: new RecordingPartialStore(root, scope), reopen: async () => new RecordingPartialStore(root, scope) }
}))
  it(contract.name, contract.run)
const seed = async (root: string) => {
  const storage = new RecordingPartialStore(root, locator)
  const writer = await storage.open(locator, { validator: '"example-v1"', total: 6 })
  try {
    await writer.write(new TextEncoder().encode("abc"))
    await writer.checkpoint()
  } finally {
    await writer.close()
  }
  return storage
}
it("rejects a tampered prefix before a caller can append", async () => {
  const root = await directory()
  const storage = await seed(root)
  await writeFile(storage.path, "xyz")
  await expect(storage.load(locator)).rejects.toThrow("checksum")
})
it("rechecks the opened writable handle after a verified load", async () => {
  const root = await directory()
  const storage = await seed(root)
  const partial = await storage.load(locator)
  expect(partial).not.toBeNull()
  await writeFile(storage.path, "xyz")
  await expect(
    storage.open(locator, { resume: partial ?? undefined, validator: '"example-v1"', total: 6 }),
  ).rejects.toThrow("changed before append")
})
it("separates account, occurrence and asset scopes without persisting signed URLs", async () => {
  const root = await directory()
  await seed(root)
  for (const scope of [
    { ...locator, account: "BobSample" },
    { ...locator, occurrenceId: "other-occurrence" },
    { ...locator, assetId: "other-asset" },
    { ...locator, provider: "other-provider" },
  ]) {
    expect(await new RecordingPartialStore(root, scope).load(scope)).toBeNull()
  }
  const names = await readdir(root)
  const metadata = names.find((name) => name.endsWith(".json"))
  expect(metadata).toBeTruthy()
  expect(await readFile(join(root, metadata ?? ""), "utf8")).not.toMatch(/https?:|token|signature|password/)
})
it("rejects a foreign caller scope before reading or writing", async () => {
  const storage = new RecordingPartialStore(await directory(), locator)
  const foreign = { ...locator, account: "BobSample" }
  await expect(storage.load(foreign)).rejects.toThrow("scope")
  await expect(storage.open(foreign, { validator: null, total: null })).rejects.toThrow("scope")
})
it("nonpersistent transfers never load or create durable metadata", async () => {
  const root = await directory()
  await seed(root)
  const storage = new RecordingPartialStore(root, locator, undefined, false)
  expect(await storage.load(locator)).toBeNull()
  const before = await readdir(root)
  const writer = await storage.open(locator, { validator: '"example-v1"', total: 3 })
  try {
    await writer.write(new TextEncoder().encode("new"))
    await writer.checkpoint()
    expect((await writer.finish()).size).toBe(3)
  } finally {
    await writer.close()
  }
  expect((await readdir(root)).filter((name) => name.endsWith(".json"))).toEqual(
    before.filter((name) => name.endsWith(".json")),
  )
})
it("restarting without a validator removes stale resume metadata", async () => {
  const root = await directory()
  const storage = await seed(root)
  const writer = await storage.open(locator, { validator: null, total: null })
  try {
    await writer.write(new TextEncoder().encode("new"))
    await writer.checkpoint()
  } finally {
    await writer.close()
  }
  expect(await storage.load(locator)).toBeNull()
})
it("bounded metadata rejects malformed and oversized records", async () => {
  const root = await directory()
  const storage = await seed(root)
  const name = (await readdir(root)).find((name) => name.endsWith(".json")) ?? ""
  for (const value of [
    "invalid",
    "x".repeat(16385),
    JSON.stringify({ locator, offset: 3, sha256: "bad" }),
    JSON.stringify({ locator, offset: 3, sha256: createHash("sha256").update("abc").digest("hex"), token: "example" }),
  ]) {
    await writeFile(join(root, name), value)
    await expect(storage.load(locator)).rejects.toThrow("metadata")
  }
})
it("rejects symlinked partial and metadata files", async () => {
  if (process.platform === "win32") return
  const root = await directory()
  await seed(root)
  const target = join(root, "ordinary-example.txt")
  await writeFile(target, "abc")
  const foreignRoot = await directory()
  const foreign = new RecordingPartialStore(foreignRoot, locator)
  await symlink(target, foreign.path)
  const metadataName = (await readdir(root)).find((name) => name.endsWith(".json")) ?? ""
  await writeFile(join(foreignRoot, metadataName), await readFile(join(root, metadataName)))
  await expect(foreign.load(locator)).rejects.toThrow("symlink")
  const otherRoot = await directory()
  await symlink(join(root, metadataName), join(otherRoot, metadataName))
  await expect(new RecordingPartialStore(otherRoot, locator).load(locator)).rejects.toThrow("symlink")
})
it("cancellation leaves an acknowledged prefix resumable by a fresh adapter", async () => {
  const root = await directory()
  await seed(root)
  const controller = new AbortController()
  controller.abort()
  await expect(new RecordingPartialStore(root, locator, controller.signal).load(locator)).rejects.toMatchObject({
    code: "cancelled",
  })
  const reopened = new RecordingPartialStore(root, locator)
  const partial = await reopened.load(locator)
  const writer = await reopened.open(locator, { resume: partial ?? undefined, validator: '"example-v1"', total: 6 })
  try {
    await writer.write(new TextEncoder().encode("def"))
    expect(await writer.finish()).toEqual({ size: 6, sha256: createHash("sha256").update("abcdef").digest("hex") })
  } finally {
    await writer.close()
  }
})

it("recovers an uncheckpointed tail only after verifying the checkpoint prefix", async () => {
  const root = await directory()
  const storage = await seed(root)
  await writeFile(storage.path, "abcUNCOMMITTED")
  const partial = await storage.load(locator)
  expect(partial?.offset).toBe(3)
  const writer = await storage.open(locator, { resume: partial ?? undefined, validator: '"example-v1"', total: 6 })
  try {
    await writer.write(new TextEncoder().encode("def"))
    expect((await writer.finish()).size).toBe(6)
  } finally {
    await writer.close()
  }
  expect(await readFile(storage.path, "utf8")).toBe("abcdef")
})

it("round-trips allowed escaped identifiers within the bounded metadata budget", async () => {
  const root = await directory()
  const scope = {
    provider: "example-video",
    account: "\u0001".repeat(1000),
    occurrenceId: "\u0002".repeat(512),
    assetId: "\u0003".repeat(512),
  }
  const storage = new RecordingPartialStore(root, scope)
  const writer = await storage.open(scope, { validator: '"example-v1"', total: 3 })
  try {
    await writer.write(new TextEncoder().encode("abc"))
    await writer.checkpoint()
  } finally {
    await writer.close()
  }
  expect((await new RecordingPartialStore(root, scope).load(scope))?.offset).toBe(3)
})

it("uses Core native persistence to resume independently written legacy Zoom checkpoints", async () => {
  const root = await directory()
  const key = createHash("sha256")
    .update(JSON.stringify([locator.provider, locator.account, locator.occurrenceId, locator.assetId]))
    .digest("hex")
  const sha256 = createHash("sha256").update("abc").digest("hex")
  const path = join(root, `.zoom-partial-${key}.part`)
  const metadata = JSON.stringify({ locator, offset: 3, sha256, validator: '"example-v1"', total: 6 })
  await writeFile(path, "abc")
  await writeFile(join(root, `.zoom-partial-${key}.json`), metadata)
  const storage = new RecordingPartialStore(root, locator)
  expect(storage).toBeInstanceOf(NativeRecordingPartialStore)
  expect(storage.path).toBe(path)
  const partial = await storage.load(locator)
  const writer = await storage.open(locator, { resume: partial ?? undefined, validator: '"example-v1"', total: 6 })
  try {
    await writer.write(Buffer.from("def"))
    await writer.finish()
  } finally {
    await writer.close()
  }
  expect(await readFile(path, "utf8")).toBe("abcdef")
  expect(storage.completed?.offset).toBe(6)
})

it.each(["cancelled", "timeout"])(
  "retains Zoom's %s error mapping and cancellation-independent close",
  async (code) => {
    const root = await directory()
    const controller = new AbortController()
    const storage = new RecordingPartialStore(root, locator, controller.signal)
    const writer = await storage.open(locator, { validator: '"example-v1"', total: 6 })
    try {
      await writer.write(Buffer.from("abc"))
      await writer.checkpoint()
      controller.abort(code === "timeout" ? new DOMException("example timeout", "TimeoutError") : undefined)
      await expect(writer.write(Buffer.from("def"))).rejects.toMatchObject({ code })
      await expect(writer.finish()).rejects.toMatchObject({ code })
      expect(storage.completed).toBeNull()
    } finally {
      await expect(writer.close()).resolves.toBeUndefined()
    }
    expect(await new RecordingPartialStore(root, locator).load(locator)).toMatchObject({ offset: 3 })
  },
)
