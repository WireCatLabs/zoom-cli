import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { inspectArchive, verifyArchive } from "./recording-archive.js"
import { type ArchiveSyncReceipt, syncRecordingArchive } from "./recording-sync.js"
import { type ArchiveReport, type DownloadOptions, type RecordingMeeting, ZoomRecordings } from "./recordings.js"

const handles = vi.hoisted(() => ({ tracking: false, active: 0, maximum: 0 }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args)
      const tracked = handles.tracking
      if (tracked) handles.maximum = Math.max(handles.maximum, ++handles.active)
      let closed = false
      return new Proxy(file, {
        get(target, key) {
          if (key === "close")
            return async () => {
              try {
                return await target.close()
              } finally {
                if (tracked && !closed) {
                  closed = true
                  handles.active--
                }
              }
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})
const meeting = (uuid = "example-occurrence"): RecordingMeeting => ({
  id: "123456",
  uuid,
  title: "Example planning",
  startedAt: null,
  assets: [],
})
const report = (uuid = "example-occurrence"): ArchiveReport => ({
  uuid,
  manifestPath: "example-manifest.json",
  downloaded: [],
  skipped: [],
  unavailable: [],
})
const collect = async (iterable: AsyncIterable<ArchiveSyncReceipt>) => {
  const result: ArchiveSyncReceipt[] = []
  for await (const item of iterable) result.push(item)
  return result
}
const options = { from: "2026-01-15", to: "2026-03-10", destination: "example-archive" }

it("chunks nonoverlapping inclusive calendar windows across leap years and year boundaries", async () => {
  for (const [from, to, expected] of [
    [
      "2026-01-15",
      "2026-03-10",
      [
        { from: "2026-01-15", to: "2026-01-31" },
        { from: "2026-02-01", to: "2026-02-28" },
        { from: "2026-03-01", to: "2026-03-10" },
      ],
    ],
    [
      "2024-02-29",
      "2024-03-01",
      [
        { from: "2024-02-29", to: "2024-02-29" },
        { from: "2024-03-01", to: "2024-03-01" },
      ],
    ],
    [
      "2026-12-31",
      "2027-01-01",
      [
        { from: "2026-12-31", to: "2026-12-31" },
        { from: "2027-01-01", to: "2027-01-01" },
      ],
    ],
  ] as const) {
    const windows: { from: string; to: string }[] = []
    const source = {
      list: async (range: { from: string; to: string }) => {
        windows.push({ from: range.from, to: range.to })
        return []
      },
      download: async () => {
        throw new Error("unexpected download")
      },
    }
    expect(await collect(syncRecordingArchive(source, { ...options, from, to }))).toEqual([])
    expect(windows).toEqual(expected)
  }
})
it("validates dates, ten-calendar-year bounds and destination/limits before any IO", async () => {
  let calls = 0
  const source = {
    list: async () => {
      calls++
      return []
    },
    download: async () => {
      throw new Error("unexpected download")
    },
  }
  for (const change of [
    { from: "bad" },
    { from: "2026-02-30" },
    { to: "2025-01-01" },
    { to: "2036-01-16" },
    { destination: " " },
    { maxBytes: 0 },
    { maxBytes: 1.5 },
    { maxBytes: Number.POSITIVE_INFINITY },
  ])
    await expect(syncRecordingArchive(source, { ...options, ...change }).next()).rejects.toMatchObject({
      code: "validation_error",
    })
  expect(calls).toBe(0)
  expect(await collect(syncRecordingArchive(source, { ...options, to: "2036-01-15" }))).toEqual([])
  expect(calls).toBe(121)
  await expect(
    syncRecordingArchive(source, { ...options, from: "2024-02-29", to: "2034-03-01" }).next(),
  ).rejects.toThrow(/ten calendar years/)
  expect(await collect(syncRecordingArchive(source, { ...options, from: "2024-02-29", to: "2034-02-28" }))).toEqual([])
  await expect(
    syncRecordingArchive(source, { ...options, from: "0001-01-01", to: "0011-01-02" }).next(),
  ).rejects.toThrow(/ten calendar years/)
})
it("deduplicates UUIDs across months and yields completed serial receipts with consumer backpressure", async () => {
  const signal = new AbortController().signal
  const calls: string[] = []
  let active = 0
  let maximum = 0
  const source = {
    list: async (range: { from: string; signal?: AbortSignal }) => {
      expect(range.signal).toBe(signal)
      calls.push(`list ${range.from}`)
      return [meeting(), meeting(`example-${range.from}`)]
    },
    download: async (id: string, download: { destination: string; signal?: AbortSignal; maxBytes?: number }) => {
      expect(download).toEqual({ destination: options.destination, signal, maxBytes: 10 })
      maximum = Math.max(maximum, ++active)
      calls.push(`download ${id}`)
      await Promise.resolve()
      active--
      return report(id)
    },
  }
  const sync = syncRecordingArchive(source, { ...options, signal, maxBytes: 10 })
  expect((await sync.next()).value?.meeting.uuid).toBe("example-occurrence")
  expect(calls).toEqual(["list 2026-01-15", "download example-occurrence"])
  const remainder = await collect(sync)
  expect(remainder.map((receipt) => receipt.meeting.uuid)).toEqual([
    "example-2026-01-15",
    "example-2026-02-01",
    "example-2026-03-01",
  ])
  expect(maximum).toBe(1)
})
it("preserves completed receipts when a later occurrence fails and never retries writes", async () => {
  const failure = new Error("Example download failure")
  let calls = 0
  const source = {
    list: async () => [meeting(), meeting("example-next")],
    download: async () => {
      calls++
      if (calls === 2) throw failure
      return report()
    },
  }
  const sync = syncRecordingArchive(source, options)
  expect((await sync.next()).value?.archive).toEqual(report())
  await expect(sync.next()).rejects.toBe(failure)
  expect(calls).toBe(2)
  const discovery = new Error("Example discovery failure")
  await expect(
    syncRecordingArchive(
      {
        list: async () => {
          throw discovery
        },
        download: source.download,
      },
      options,
    ).next(),
  ).rejects.toBe(discovery)
})
it("cancels before further discovery/downloads and preserves a completed late receipt", async () => {
  const abort = new AbortController()
  abort.abort()
  const never = {
    list: async () => {
      throw new Error("unexpected list")
    },
    download: async () => {
      throw new Error("unexpected download")
    },
  }
  await expect(syncRecordingArchive(never, { ...options, signal: abort.signal }).next()).rejects.toMatchObject({
    code: "cancelled",
  })
  const during = new AbortController()
  let downloads = 0
  const source = {
    list: async () => {
      during.abort()
      return [meeting()]
    },
    download: async () => {
      downloads++
      return report()
    },
  }
  await expect(syncRecordingArchive(source, { ...options, signal: during.signal }).next()).rejects.toMatchObject({
    code: "cancelled",
  })
  expect(downloads).toBe(0)
  const late = new AbortController()
  let lists = 0
  const finished = {
    list: async () => {
      lists++
      return [meeting(), meeting("example-other")]
    },
    download: async () => {
      late.abort()
      return report()
    },
  }
  const sync = syncRecordingArchive(finished, { ...options, signal: late.signal })
  expect((await sync.next()).value?.archive).toEqual(report())
  await expect(sync.next()).rejects.toMatchObject({ code: "cancelled" })
  expect(lists).toBe(1)
})
it("reuses provider pagination and verified manifests for repeated actual source sync", async () => {
  const destination = await mkdtemp(join(tmpdir(), "zm-test-sync-"))
  const scopes = ["cloud_recording:read:list_user_recordings", "cloud_recording:read:list_recording_files"]
  const tokens = {
    tokens: async () => ({
      accessToken: "example-access",
      refreshToken: "example-refresh",
      expiresAt: 3600000,
      scopes,
    }),
  }
  const asset = {
    id: "example-file",
    status: "completed",
    file_extension: "TXT",
    file_type: "CHAT",
    file_size: 5,
    download_url: "https://zoom.us/example-download?signature=example-private",
  }
  const body = { id: 123456, uuid: "example-uuid", topic: "Example planning", recording_files: [asset] }
  let downloads = 0
  let pageRequests = 0
  const source = new ZoomRecordings(
    tokens,
    async (input) => {
      const url = new URL(String(input))
      if (url.pathname === "/v2/users/me/recordings") {
        pageRequests++
        return new Response(
          JSON.stringify({
            meetings: [body],
            next_page_token: url.searchParams.has("next_page_token") ? "" : "example-next",
          }),
        )
      }
      if (url.hostname === "api.zoom.us") return new Response(JSON.stringify(body))
      downloads++
      return new Response("hello")
    },
    { sleep: async () => {} },
  )
  const first = await collect(
    syncRecordingArchive(source, { ...options, from: "2026-10-01", to: "2026-10-10", destination }),
  )
  const second = await collect(
    syncRecordingArchive(source, { ...options, from: "2026-10-01", to: "2026-10-10", destination }),
  )
  expect(first[0]?.archive.downloaded).toHaveLength(1)
  expect(second[0]?.archive.skipped).toHaveLength(1)
  expect(downloads).toBe(1)
  expect(pageRequests).toBe(4)
  expect(JSON.stringify(first)).not.toMatch(/signature|example-access/)
})

it("preflights every download option before reading tokens or requesting recording details", async () => {
  let tokens = 0
  let requests = 0
  const source = new ZoomRecordings(
    {
      tokens: async () => {
        tokens++
        throw new Error("unexpected tokens")
      },
    },
    async () => {
      requests++
      throw new Error("unexpected request")
    },
  )
  for (const options of [
    { destination: " " },
    { destination: null },
    { destination: "example", maxBytes: 0 },
    { destination: "example", maxBytes: null },
    { destination: "example", maxBytes: Number.NaN },
    { destination: "example", fileIds: "example" },
    { destination: "example", fileIds: [] },
    { destination: "example", fileIds: [""] },
    { destination: "example", fileIds: [3] },
  ])
    await expect(source.download("example", options as unknown as DownloadOptions)).rejects.toMatchObject({
      code: "validation_error",
    })
  expect(tokens).toBe(0)
  expect(requests).toBe(0)
})

it("bounds local manifest reads and verification hashes to one open handle", async () => {
  const destination = await mkdtemp(join(tmpdir(), "zm-test-sync-handles-"))
  const scopes = ["cloud_recording:read:list_recording_files"]
  const tokens = {
    tokens: async () => ({
      accessToken: "example-access",
      refreshToken: "example-refresh",
      expiresAt: 3600000,
      scopes,
    }),
  }
  const recordings = new ZoomRecordings(tokens, async (input) => {
    const url = new URL(String(input))
    if (url.hostname === "api.zoom.us")
      return new Response(
        JSON.stringify({
          id: 123456,
          uuid: url.pathname.split("/").at(-2),
          recording_files: [
            {
              id: "example-file",
              status: "completed",
              file_extension: "TXT",
              file_size: 5,
              download_url: "https://zoom.us/example-download",
            },
          ],
        }),
      )
    return new Response("hello")
  })
  for (const id of ["example-one", "example-two", "example-three"]) await recordings.download(id, { destination })
  handles.active = 0
  handles.maximum = 0
  handles.tracking = true
  try {
    expect(await inspectArchive(destination)).toHaveLength(3)
    expect(await verifyArchive(destination)).toMatchObject([{ valid: true }, { valid: true }, { valid: true }])
    expect(handles.active).toBe(0)
    expect(handles.maximum).toBe(1)
  } finally {
    handles.tracking = false
  }
})
it("resumes verified archive acknowledgements with an explicit account and durable native checkpoint", async () => {
  const destination = await mkdtemp(join(tmpdir(), "zm-test-sync-resume-"))
  const asset = {
    id: "AliceExample-file",
    type: "chat",
    format: "TXT",
    size: 5,
    status: "completed",
    available: true,
    startedAt: null,
    endedAt: null,
  }
  const item = { ...meeting("AliceExample-occurrence"), assets: [asset] }
  const calls: DownloadOptions[] = []
  const source = {
    list: async () => [item],
    download: async (uuid: string, options: DownloadOptions): Promise<ArchiveReport> => {
      calls.push(options)
      return {
        ...report(uuid),
        downloaded: [
          {
            id: asset.id,
            type: asset.type,
            format: asset.format,
            remoteSize: asset.size,
            size: asset.size,
            path: "AliceExample.txt",
            sha256: "a".repeat(64),
            startedAt: null,
            endedAt: null,
          },
        ],
      }
    },
  }
  const opts = {
    ...options,
    from: "2026-01-01",
    to: "2026-01-31",
    destination,
    resume: true,
    account: "AliceExample",
    now: () => 1000,
  }
  const first = await collect(syncRecordingArchive(source, opts))
  expect(first).toMatchObject([{ availability: "unknown", checkpointRevision: 2, meeting: { uuid: item.uuid } }])
  expect(await collect(syncRecordingArchive(source, opts))).toEqual([])
  expect(calls).toEqual([{ destination, signal: expect.any(AbortSignal), resume: true, account: "AliceExample" }])
  await expect(collect(syncRecordingArchive(source, { ...opts, account: "BobSample" }))).rejects.toMatchObject({
    code: "configuration_error",
  })
  await expect(collect(syncRecordingArchive(source, { ...opts, maxBytes: 12 }))).rejects.toMatchObject({
    code: "configuration_error",
  })
})
it("validates checkpoint selection before remote discovery and snapshots options before asynchronous work", async () => {
  let calls = 0
  const source = {
    list: async () => {
      calls++
      return []
    },
    download: async () => report(),
  }
  for (const change of [
    { resume: true },
    { checkpointPath: "example.json" },
    { resume: true, account: "AliceExample", checkpointPath: " " },
  ])
    await expect(collect(syncRecordingArchive(source, { ...options, ...change }))).rejects.toMatchObject({
      code: "validation_error",
    })
  expect(calls).toBe(0)
  const destination = await mkdtemp(join(tmpdir(), "zm-test-sync-snapshot-"))
  const opts = { ...options, to: "2026-01-31", destination }
  const captured: string[] = []
  const changed = {
    list: async () => {
      opts.destination = "changed-BobSample"
      return [meeting()]
    },
    download: async (_id: string, values: DownloadOptions) => {
      captured.push(values.destination)
      return report()
    },
  }
  await collect(syncRecordingArchive(changed, opts))
  expect(captured).toEqual([destination])
})
it("uses the scoped one-page catalog adapter without materializing the entire provider range", async () => {
  const requests: string[] = []
  const source = new ZoomRecordings(
    {
      tokens: async () => ({
        accessToken: "AliceExample-access",
        refreshToken: "AliceExample-refresh",
        expiresAt: 3600000,
        scopes: ["cloud_recording:read:list_user_recordings"],
      }),
    },
    async (input) => {
      requests.push(String(input))
      return new Response(
        JSON.stringify({
          meetings: [
            { id: 123456, uuid: "opaque/AliceExample+?", topic: "Alice Example planning", recording_files: [] },
          ],
          next_page_token: "page-BobSample",
        }),
      )
    },
  )
  const catalog = source.catalog("AliceExample")
  const first = await catalog.list({ account: "AliceExample", from: "2026-01-01", to: "2026-01-31" })
  expect(first).toMatchObject({ items: [{ externalId: "opaque/AliceExample+?" }], nextCursor: "page-BobSample" })
  expect(requests).toHaveLength(1)
  await expect(catalog.list({ account: "BobSample", from: "2026-01-01", to: "2026-01-31" })).rejects.toMatchObject({
    code: "validation_error",
  })
  expect(requests).toHaveLength(1)
  expect(() => source.catalog(" ")).toThrow()
  await expect(source.listPage({ from: "2026-01-01", to: "2026-01-31", cursor: " " })).rejects.toMatchObject({
    code: "validation_error",
  })
})
