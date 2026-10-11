import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { archiveRecording, verifyArchive } from "./recording-archive.js"
import type { RecordingMeeting } from "./recordings.js"
import { ZoomRemote } from "./remote-http.js"

const crash = vi.hoisted(() => ({ enabled: false }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (crash.enabled && /\.zoom-archive-[a-f0-9]{64}\.json$/.test(String(args[1]))) {
        crash.enabled = false
        throw new Error("invented manifest commit crash")
      }
      return fs.rename(...args)
    },
  }
})
const meeting: RecordingMeeting = {
  id: "123456",
  uuid: "example-occurrence",
  title: "Alice Example planning",
  startedAt: null,
  assets: [
    {
      id: "example-video",
      type: "video",
      format: "MP4",
      size: 6,
      status: "completed",
      available: true,
      startedAt: null,
      endedAt: null,
    },
  ],
}
const urls = new Map([["example-video", "https://zoom.us/example-download?signature=example-private"]])
const tokens = {
  tokens: async () => ({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    scopes: [],
    expiresAt: 3600000,
  }),
}
const source = (fetcher: typeof fetch) => new ZoomRemote(tokens, fetcher, { sleep: async () => {} })
const seedCrash = async () => {
  const destination = await mkdtemp(join(tmpdir(), "zm-test-promotion-recovery-"))
  crash.enabled = true
  await expect(
    archiveRecording(
      source(async () => new Response("abcdef", { headers: { etag: '"example-v1"', "content-length": "6" } })),
      meeting,
      urls,
      { destination, account: "AliceExample" },
    ),
  ).rejects.toThrow()
  const paths = await readdir(destination)
  const final = paths.find((path) => path.endsWith(".mp4")) ?? ""
  expect(final).not.toBe("")
  expect(paths.some((path) => path.startsWith(".zoom-promotion-") && path.endsWith(".json"))).toBe(true)
  expect(paths.some((path) => path.endsWith(".part"))).toBe(true)
  return { destination, final, paths }
}
it("recovers a promoted owned final after manifest commit interruption without downloading or overwriting", async () => {
  const { destination, final } = await seedCrash()
  let fetched = 0
  const report = await archiveRecording(
    source(async () => {
      fetched++
      throw new Error("unexpected network")
    }),
    meeting,
    urls,
    { destination, account: "AliceExample" },
  )
  expect(fetched).toBe(0)
  expect(report.downloaded).toHaveLength(0)
  expect(report.skipped).toMatchObject([{ path: final, size: 6 }])
  expect(await readFile(join(destination, final), "utf8")).toBe("abcdef")
  expect(await verifyArchive(destination)).toMatchObject([{ valid: true }])
})
it("refuses a final whose content changed after promotion", async () => {
  const { destination, final } = await seedCrash()
  await writeFile(join(destination, final), "xxxxxx")
  await expect(
    archiveRecording(
      source(async () => {
        throw new Error("unexpected network")
      }),
      meeting,
      urls,
      { destination, account: "AliceExample" },
    ),
  ).rejects.toThrow("checksum")
  expect(await readFile(join(destination, final), "utf8")).toBe("xxxxxx")
})
it("refuses to adopt another account's promotion or changed provider metadata", async () => {
  const { destination, final } = await seedCrash()
  const forbidden = source(async () => {
    throw new Error("unexpected network")
  })
  await expect(archiveRecording(forbidden, meeting, urls, { destination, account: "BobSample" })).rejects.toThrow(
    "recovery record",
  )
  const changed = { ...meeting, title: "Bob Sample changed title" }
  await expect(archiveRecording(forbidden, changed, urls, { destination, account: "AliceExample" })).rejects.toThrow(
    "does not match",
  )
  expect(await readFile(join(destination, final), "utf8")).toBe("abcdef")
})
it("refuses malformed ownership records and finals without a matching completed prefix", async () => {
  const { destination, paths } = await seedCrash()
  const forbidden = source(async () => {
    throw new Error("unexpected network")
  })
  const partial = paths.find((path) => path.endsWith(".part")) ?? ""
  await writeFile(join(destination, partial), "xxxxxx")
  await expect(archiveRecording(forbidden, meeting, urls, { destination, account: "AliceExample" })).rejects.toThrow(
    "checksum",
  )
  const record = paths.find((path) => path.startsWith(".zoom-promotion-") && path.endsWith(".json")) ?? ""
  await writeFile(join(destination, record), JSON.stringify({ version: 1, token: "example" }))
  await expect(archiveRecording(forbidden, meeting, urls, { destination, account: "AliceExample" })).rejects.toThrow(
    "recovery record",
  )
})
it("refuses weak-validator promotion recovery while preserving the final", async () => {
  const destination = await mkdtemp(join(tmpdir(), "zm-test-weak-promotion-"))
  crash.enabled = true
  await expect(
    archiveRecording(
      source(async () => new Response("abcdef", { headers: { etag: 'W/"example-weak"', "content-length": "6" } })),
      meeting,
      urls,
      { destination, account: "AliceExample" },
    ),
  ).rejects.toThrow()
  const names = await readdir(destination)
  const final = names.find((name) => name.endsWith(".mp4")) ?? ""
  expect(names.some((name) => name.startsWith(".zoom-promotion-") && name.endsWith(".json"))).toBe(false)
  await expect(
    archiveRecording(
      source(async () => {
        throw new Error("unexpected network")
      }),
      meeting,
      urls,
      { destination, account: "AliceExample" },
    ),
  ).rejects.toThrow("recovery record")
  expect(await readFile(join(destination, final), "utf8")).toBe("abcdef")
})

it("bounds recovery metadata before promotion and when reopening a journal", async () => {
  const destination = await mkdtemp(join(tmpdir(), "zm-test-promotion-bound-"))
  const oversized = { ...meeting, title: "AliceExample".repeat(4000) }
  await expect(
    archiveRecording(
      source(async () => new Response("abcdef", { headers: { etag: '"example-v1"', "content-length": "6" } })),
      oversized,
      urls,
      { destination, account: "AliceExample" },
    ),
  ).rejects.toThrow("metadata limit")
  expect((await readdir(destination)).some((name) => name.endsWith(".mp4"))).toBe(false)
  const crashed = await seedCrash()
  const name = crashed.paths.find((name) => name.startsWith(".zoom-promotion-") && name.endsWith(".json")) ?? ""
  await writeFile(join(crashed.destination, name), "x".repeat(32769))
  await expect(
    archiveRecording(
      source(async () => {
        throw new Error("unexpected network")
      }),
      meeting,
      urls,
      { destination: crashed.destination, account: "AliceExample" },
    ),
  ).rejects.toThrow("recovery record")
})
