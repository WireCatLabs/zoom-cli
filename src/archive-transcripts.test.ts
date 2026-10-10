import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFile, copyFile, mkdir, mkdtemp, rename, symlink, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError } from "@wirecat/cli-core"
import { afterEach, expect, it, vi } from "vitest"
import { readArchiveTranscripts, searchArchiveTranscripts } from "./archive-transcripts.js"

const handles = vi.hoisted(() => ({
  path: "",
  opened: 0,
  closed: 0,
  lists: 0,
  afterOpen: undefined as (() => Promise<void> | void) | undefined,
  afterStat: undefined as (() => Promise<void>) | undefined,
  afterRead: undefined as (() => void) | undefined,
  afterList: undefined as (() => Promise<void>) | undefined,
  failure: false,
}))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    readdir: async (...args: Parameters<typeof fs.readdir>) => {
      handles.lists++
      const names = await fs.readdir(...args)
      await handles.afterList?.()
      return names
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      if (args[0] !== handles.path) return fs.open(...args)
      if (handles.failure) throw new Error("example private failure")
      const file = await fs.open(...args)
      handles.opened++
      await handles.afterOpen?.()
      return new Proxy(file, {
        get(target, key) {
          if (key === "close")
            return async () => {
              handles.closed++
              await target.close()
            }
          if (key === "stat")
            return async () => {
              const result = await target.stat()
              await handles.afterStat?.()
              return result
            }
          if (key === "read")
            return async (...options: Parameters<typeof file.read>) => {
              const result = await target.read(...options)
              handles.afterRead?.()
              return result
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})
const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex")
const vtt =
  "WEBVTT\n\n00:00.000 --> 00:02.000\nExample Speaker: Café [Plan]\n\n00:02.000 --> 00:03.000\nOther: Second plan\n"
const fixture = async (content: string | Buffer = vtt, format: string | null = "vtt") => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-offline-vtt-"))
  const uuid = "example-occurrence"
  const id = "example-asset"
  const path = join(root, `${digest(uuid)}-${digest(id)}.${format ?? "bin"}`)
  const bytes = Buffer.from(content)
  await writeFile(path, bytes)
  await writeFile(
    join(root, `.zoom-archive-${digest(uuid)}.json`),
    JSON.stringify({
      version: 1,
      meeting: { id: "123456", uuid, title: "Example", startedAt: null },
      files: [
        {
          id,
          path: path.slice(root.length + 1),
          size: bytes.length,
          sha256: digest(bytes),
          remoteSize: null,
          type: "audio_transcript",
          format,
          startedAt: null,
          endedAt: null,
        },
      ],
    }),
  )
  return { root, uuid, id, path, bytes }
}
const collect = async (root: string, options = {}) => {
  const results = []
  for await (const item of readArchiveTranscripts(root, options)) results.push(item)
  return results
}
const track = (path: string) => {
  handles.path = path
  handles.opened = 0
  handles.closed = 0
  handles.afterOpen = undefined
  handles.afterStat = undefined
  handles.afterRead = undefined
  handles.afterList = undefined
  handles.failure = false
}
afterEach(() => track(""))

it("yields verified cues with provenance only after closing the same read handle", async () => {
  const { root, uuid, id, path } = await fixture()
  track(path)
  const reader = readArchiveTranscripts(root, { uuid, fileIds: [id, id] })
  const first = await reader.next()
  expect(handles.opened).toBe(1)
  expect(handles.closed).toBe(1)
  expect(first.value).toMatchObject({
    meeting: { uuid, title: "Example" },
    asset: { id, format: "vtt" },
    cues: [
      { startMs: 0, endMs: 2000, speaker: "Example Speaker", text: "Café [Plan]" },
      { startMs: 2000, endMs: 3000, speaker: "Other", text: "Second plan" },
    ],
  })
  expect((await reader.next()).done).toBe(true)
  expect(JSON.stringify(first.value)).not.toMatch(/https:|token|signature/)
})

it("searches NFC-normalized lowercase literal text with bounded cue positions", async () => {
  const { root, uuid, id } = await fixture()
  expect((await searchArchiveTranscripts(root, "CAFE\u0301 [PLAN]", { limit: 1 })).items).toMatchObject([
    { meeting: { uuid }, asset: { id }, position: 0, startMs: 0, endMs: 2000, text: "Café [Plan]" },
  ])
  expect((await searchArchiveTranscripts(root, "plan")).items.map((hit) => hit.position)).toEqual([0, 1])
  expect((await searchArchiveTranscripts(root, "Example Speaker")).items).toEqual([])
  expect((await searchArchiveTranscripts(root, ".*")).items).toEqual([])
  expect(await searchArchiveTranscripts(root, "plan", { limit: 1 })).toMatchObject({ page: 1, limit: 1, hasMore: true })
  expect(await searchArchiveTranscripts(root, "plan", { limit: 2 })).toMatchObject({
    page: 1,
    limit: 2,
    hasMore: false,
  })
})

it("validates selectors, limits and queries before filesystem discovery", async () => {
  const before = handles.lists
  for (const options of [{ maxBytes: 0 }, { maxBytes: 1.5 }, { uuid: " " }, { fileIds: [] }, { fileIds: [""] }])
    await expect(collect("example", options)).rejects.toMatchObject({ code: "validation_error" })
  await expect(collect(" ")).rejects.toMatchObject({ code: "validation_error" })
  for (const limit of [0, 1001, 1.5])
    await expect(searchArchiveTranscripts("example", "plan", { limit })).rejects.toMatchObject({
      code: "validation_error",
    })
  await expect(searchArchiveTranscripts("example", " ")).rejects.toMatchObject({ code: "validation_error" })
  expect(handles.lists).toBe(before)
})

it("rejects unknown UUID and non-VTT file selectors before asset opens", async () => {
  const { root, path, id } = await fixture("Example chat", "txt")
  track(path)
  await expect(collect(root, { uuid: "missing-example" })).rejects.toMatchObject({ code: "not_found" })
  await expect(collect(root, { fileIds: [id] })).rejects.toMatchObject({ code: "not_found" })
  expect(await collect(root)).toEqual([])
  expect(handles.opened).toBe(0)
  const vttFixture = await fixture()
  track(vttFixture.path)
  await expect(collect(vttFixture.root, { fileIds: [vttFixture.id, "missing"] })).rejects.toMatchObject({
    code: "not_found",
  })
  expect(handles.opened).toBe(0)
})

it("rejects manifest/file size and checksum disagreement without yielding false results", async () => {
  const { root, path } = await fixture()
  await writeFile(path, vtt.replace("Café", "Cafè"))
  await expect(collect(root)).rejects.toThrow(/checksum/)
  await writeFile(path, "short")
  await expect(searchArchiveTranscripts(root, "short")).rejects.toThrow(/size verification/)
})

it("rejects oversized metadata, files and growth during reading", async () => {
  const { root, path, bytes } = await fixture()
  await expect(collect(root, { maxBytes: 1 })).rejects.toThrow(/byte limit/)
  await appendFile(path, "extra")
  await expect(collect(root, { maxBytes: bytes.length })).rejects.toThrow(/byte limit/)
  await writeFile(path, bytes)
  track(path)
  handles.afterStat = async () => {
    handles.afterStat = undefined
    await appendFile(path, "extra")
  }
  await expect(collect(root, { maxBytes: bytes.length })).rejects.toThrow(/byte limit/)
  expect(handles.closed).toBe(1)
})

it("rejects malformed UTF-8 and VTT with safe messages", async () => {
  const invalidUtf8 = await fixture(Buffer.from([0xff]))
  await expect(collect(invalidUtf8.root)).rejects.toThrow(/UTF-8/)
  const invalidVtt = await fixture("Example invalid transcript")
  await expect(collect(invalidVtt.root)).rejects.toThrow(/WebVTT/)
  const emptyVtt = await fixture("WEBVTT\r\r")
  expect((await collect(emptyVtt.root))[0]?.cues).toEqual([])
})

it("refuses symlinks and missing assets rather than searching arbitrary files", async () => {
  const { root, path } = await fixture()
  await rename(path, `${path}.example-backup`)
  await symlink(`${path}.example-backup`, path)
  await expect(collect(root)).rejects.toThrow(/symlink/)
  await unlink(path)
  await expect(collect(root)).rejects.toMatchObject({ code: "not_found" })
  await mkdir(path)
  await expect(collect(root)).rejects.toThrow(/ordinary file/)
})

it("reads serially with consumer backpressure and skips unselected VTT assets", async () => {
  const { root, path, bytes, uuid } = await fixture()
  const secondId = "example-second-asset"
  const secondName = `${digest(uuid)}-${digest(secondId)}.vtt`
  await copyFile(path, join(root, secondName))
  const manifest = {
    version: 1,
    meeting: { id: "123456", uuid, title: "Example", startedAt: null },
    files: ["example-asset", secondId].map((id) => ({
      id,
      path: `${digest(uuid)}-${digest(id)}.vtt`,
      size: bytes.length,
      sha256: digest(bytes),
      remoteSize: null,
      type: "audio_transcript",
      format: "vtt",
      startedAt: null,
      endedAt: null,
    })),
  }
  await writeFile(join(root, `.zoom-archive-${digest(uuid)}.json`), JSON.stringify(manifest))
  track(join(root, secondName))
  const reader = readArchiveTranscripts(root)
  await reader.next()
  expect(handles.opened).toBe(0)
  await reader.next()
  expect(handles.opened).toBe(1)
  expect(handles.closed).toBe(1)
  await reader.return()
  track(path)
  expect((await collect(root, { fileIds: [secondId] })).map((item) => item.asset.id)).toEqual([secondId])
  expect(handles.opened).toBe(0)
  expect((await searchArchiveTranscripts(root, "plan", { limit: 1 })).items.map((hit) => hit.asset.id)).toEqual([
    "example-asset",
  ])
  const abort = new AbortController()
  const cancelledReader = readArchiveTranscripts(root, { signal: abort.signal })
  await cancelledReader.next()
  abort.abort()
  await expect(cancelledReader.next()).rejects.toMatchObject({ code: "cancelled" })
  await writeFile(join(root, secondName), vtt.replace("Café", "Cafè"))
  expect((await searchArchiveTranscripts(root, "plan", { limit: 1 })).hasMore).toBe(true)
  await expect(searchArchiveTranscripts(root, "plan", { limit: 2 })).rejects.toThrow(/checksum/)
})

it("checks cancellation after open and read, closing owned handles without streams", async () => {
  const { root, path } = await fixture()
  track(path)
  const beforeOpen = new AbortController()
  beforeOpen.abort()
  await expect(collect(root, { signal: beforeOpen.signal })).rejects.toMatchObject({ code: "cancelled" })
  expect(handles.opened).toBe(0)
  const afterOpen = new AbortController()
  handles.afterOpen = () => afterOpen.abort(new CliError("timeout", "example deadline"))
  await expect(collect(root, { signal: afterOpen.signal })).rejects.toMatchObject({ code: "timeout" })
  expect(handles.closed).toBe(1)
  handles.afterOpen = undefined
  const afterRead = new AbortController()
  handles.afterRead = () => afterRead.abort()
  await expect(collect(root, { signal: afterRead.signal })).rejects.toMatchObject({ code: "cancelled" })
  expect(handles.closed).toBe(2)
})

it("uses the verified opened file even when its directory entry is replaced", async () => {
  const { root, path } = await fixture()
  track(path)
  handles.afterOpen = async () => {
    await rename(path, `${path}.example-backup`)
    await writeFile(path, "Example replacement must not be parsed")
  }
  expect((await collect(root))[0]?.cues[0]?.text).toBe("Café [Plan]")
  expect(handles.closed).toBe(1)
})

it("sanitizes unexpected local read failures", async () => {
  const { root, path } = await fixture()
  track(path)
  handles.failure = true
  await expect(collect(root)).rejects.toThrow("archive transcript could not be read")
  await expect(collect(join(root, "example-missing"))).rejects.toThrow("archive destination could not be read")
})

it("keeps one canonical archive root when a destination alias changes after discovery", async () => {
  const { root } = await fixture()
  const other = await fixture(vtt.replace("Café", "Other"))
  const alias = `${root}-example-alias`
  await symlink(root, alias)
  handles.afterList = async () => {
    handles.afterList = undefined
    await unlink(alias)
    await symlink(other.root, alias)
  }
  expect((await collect(alias))[0]?.cues[0]?.text).toBe("Café [Plan]")
})

it.skipIf(process.platform === "win32")(
  "rejects a FIFO without waiting for a writer",
  async () => {
    const { root, path } = await fixture()
    await unlink(path)
    execFileSync("mkfifo", [path])
    await expect(collect(root)).rejects.toThrow(/ordinary file/)
  },
  1000,
)
