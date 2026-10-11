import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { RecordingSyncCheckpoint } from "@wirecat/cli-meetings"
import { expect, it } from "vitest"
import { fileRecordingSyncCheckpointStore } from "./recording-sync-store.js"

const path = async () =>
  join(await mkdtemp(join(tmpdir(), "zm-test-sync-checkpoint-")), "AliceExample", "checkpoint.json")
const state = (revision = 1): RecordingSyncCheckpoint => ({
  version: 1,
  scope: { provider: "zoom", account: "AliceExample" },
  configKey: "example-config",
  revision,
  updatedAt: 1000,
  windows: [],
  pendingWindows: [{ from: "2026-01-01", to: "2026-01-31" }],
  entries: [],
})
const lockOwner = (pid: number, jobId = "AliceExample", host = hostname()) => ({
  version: 1,
  pid,
  host,
  token: randomUUID(),
  jobId,
})
it("persists versioned checkpoint bytes across process-style reopen with lease and compare-and-save", async () => {
  const destination = await path()
  const store = fileRecordingSyncCheckpointStore(destination)
  const lease = await store.acquire("AliceExample")
  expect(await store.read("AliceExample", lease.token)).toBeNull()
  await store.save("AliceExample", lease.token, null, state())
  expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(state())
  await expect(fileRecordingSyncCheckpointStore(destination).acquire("AliceExample")).rejects.toMatchObject({
    code: "conflict",
  })
  await expect(store.read("BobSample", lease.token)).rejects.toMatchObject({ code: "conflict" })
  await expect(store.read("AliceExample", "foreign")).rejects.toMatchObject({ code: "conflict" })
  await expect(store.save("AliceExample", lease.token, null, state(2))).rejects.toMatchObject({ code: "conflict" })
  await expect(store.save("AliceExample", lease.token, 1, state(1))).rejects.toMatchObject({ code: "conflict" })
  await store.save("AliceExample", lease.token, 1, state(2))
  await lease.release()
  const reopened = fileRecordingSyncCheckpointStore(destination)
  const second = await reopened.acquire("AliceExample")
  expect(await reopened.read("AliceExample", second.token)).toEqual(state(2))
  await second.release()
  await expect(second.release()).rejects.toMatchObject({ code: "conflict" })
})
it("recovers only a recognized local dead-process lease and refuses foreign, malformed or replaced owners", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" })
  const deadPid = child.pid
  if (!deadPid) throw new Error("synthetic child did not start")
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve())
    child.once("error", reject)
  })
  const destination = await path()
  await mkdir(`${destination}.lock`, { recursive: true })
  await writeFile(join(`${destination}.lock`, "owner.json"), JSON.stringify(lockOwner(deadPid)))
  const store = fileRecordingSyncCheckpointStore(destination)
  const recovered = await store.acquire("AliceExample")
  await recovered.release()
  for (const owner of [lockOwner(deadPid, "AliceExample", "foreign-host"), { version: 9 }, [], null]) {
    const target = await path()
    await mkdir(`${target}.lock`, { recursive: true })
    await writeFile(join(`${target}.lock`, "owner.json"), JSON.stringify(owner))
    await expect(fileRecordingSyncCheckpointStore(target).acquire("AliceExample")).rejects.toMatchObject({
      code: "conflict",
    })
  }
  const acquired = await store.acquire("AliceExample")
  await writeFile(join(`${destination}.lock`, "owner.json"), JSON.stringify(lockOwner(process.pid)))
  await expect(store.save("AliceExample", acquired.token, null, state())).rejects.toMatchObject({ code: "conflict" })
  await expect(acquired.release()).rejects.toMatchObject({ code: "conflict" })
})
it("bounds ordinary checkpoint and owner reads and never overwrites malformed or symlink state", async () => {
  for (const content of ["{", "x".repeat(8 * 1024 ** 2 + 1), JSON.stringify({ version: 2 })]) {
    const destination = await path()
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content)
    const store = fileRecordingSyncCheckpointStore(destination)
    const lease = await store.acquire("AliceExample")
    await expect(store.read("AliceExample", lease.token)).rejects.toThrow()
    await expect(store.save("AliceExample", lease.token, null, state())).rejects.toThrow()
    expect(await readFile(destination, "utf8")).toBe(content)
    await lease.release()
  }
  const destination = await path()
  await mkdir(dirname(destination), { recursive: true })
  const target = join(dirname(destination), "BobSample.json")
  await writeFile(target, JSON.stringify(state()))
  await symlink(target, destination)
  const store = fileRecordingSyncCheckpointStore(destination)
  const lease = await store.acquire("AliceExample")
  await expect(store.read("AliceExample", lease.token)).rejects.toMatchObject({ code: "validation_error" })
  await lease.release()
  const directory = await path()
  await mkdir(directory, { recursive: true })
  const withDirectory = fileRecordingSyncCheckpointStore(directory)
  const owned = await withDirectory.acquire("AliceExample")
  await expect(withDirectory.read("AliceExample", owned.token)).rejects.toMatchObject({ code: "validation_error" })
  await owned.release()
})
it("rejects invalid path/job inputs before creating state and serializes stale recovery attempts", async () => {
  expect(() => fileRecordingSyncCheckpointStore(" ")).toThrow()
  const destination = await path()
  const store = fileRecordingSyncCheckpointStore(destination)
  await expect(store.acquire(" ")).rejects.toMatchObject({ code: "validation_error" })
  await mkdir(`${destination}.lock`, { recursive: true })
  await mkdir(`${destination}.lock.recovery`)
  await writeFile(join(`${destination}.lock`, "owner.json"), JSON.stringify(lockOwner(process.pid)))
  await expect(store.acquire("AliceExample")).rejects.toMatchObject({ code: "conflict" })
  const ordinary = await path()
  await mkdir(dirname(ordinary), { recursive: true })
  await writeFile(`${ordinary}.lock`, "invented marker")
  await expect(fileRecordingSyncCheckpointStore(ordinary).acquire("AliceExample")).rejects.toMatchObject({
    code: "conflict",
  })
})
