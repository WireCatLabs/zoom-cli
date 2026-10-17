import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { fileRecordingSyncCheckpointStore } from "./recording-sync-store.js"

it("refuses a live checkpoint lease written by the published legacy format", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-legacy-checkpoint-lock-"))
  const path = join(directory, "checkpoint.json")
  const marker = join(`${path}.lock`, "owner.json")
  const owner = JSON.stringify({
    version: 1,
    pid: process.pid,
    host: hostname(),
    token: randomUUID(),
    jobId: "AliceExample",
  })
  await mkdir(`${path}.lock`, { mode: 0o700 })
  await writeFile(marker, owner, { mode: 0o600 })
  const store = fileRecordingSyncCheckpointStore(path)
  let acquired: Awaited<ReturnType<typeof store.acquire>> | undefined
  try {
    await expect(
      store.acquire("AliceExample").then((lease) => {
        acquired = lease
        return lease
      }),
    ).rejects.toMatchObject({ code: "configuration_error" })
    expect(await readFile(marker, "utf8")).toBe(owner)
  } finally {
    await acquired?.release()
  }
})
