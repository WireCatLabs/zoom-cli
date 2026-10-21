import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { inspectArchiveLocks, recoverArchiveLocks } from "./recording-archive.js"
import { inspectArchive, verifyArchive } from "./recording-manifest.js"
import { ZoomRecordings } from "./recordings.js"
import { ZoomRemote } from "./remote-http.js"

const grants = ["cloud_recording:read:list_user_recordings", "cloud_recording:read:list_recording_files"]
const tokens = (scopes = grants) => ({
  tokens: async () => ({ accessToken: "example-access", refreshToken: "example-refresh", expiresAt: 3600000, scopes }),
})
const response = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })
const file = (id = "example-video", overrides = {}) => ({
  id,
  file_extension: "MP4",
  recording_type: "shared_screen",
  status: "completed",
  file_size: 5,
  recording_start: "2026-10-10T15:00:00Z",
  download_url: `https://zoom.us/example-download/${id}?signature=example-private`,
  ...overrides,
})
const meeting = (files = [file()], overrides = {}) => ({
  id: 123456,
  uuid: "/example//occurrence",
  topic: "Example planning",
  start_time: "2026-10-10T15:00:00Z",
  recording_files: files,
  password: "example-private-password",
  download_access_token: "example-private-token",
  ...overrides,
})
const scope = { account: "example-account", resume: false }
const temp = () => mkdtemp(join(tmpdir(), "zm-test-archive-"))
const source = (fetcher: typeof fetch) => new ZoomRecordings(tokens(), fetcher, { sleep: async () => {}, now: () => 0 })
const scripted =
  (body: unknown = meeting()): typeof fetch =>
  async (input, init) => {
    expect(init?.redirect).toBe("manual")
    expect(init?.headers).toHaveProperty("authorization", "Bearer example-access")
    return String(input).includes("api.zoom.us")
      ? response(body)
      : new Response("hello", { headers: { "content-length": "5" } })
  }

describe("cloud recordings", () => {
  it("paginates occurrence UUIDs and returns only nonsensitive metadata including participant audio", async () => {
    let calls = 0
    const recordings = source(async (input) => {
      const url = new URL(String(input))
      expect(url.searchParams.get("from")).toBe("2026-10-01")
      expect(url.searchParams.get("to")).toBe("2026-10-10")
      calls++
      return response({ meetings: [meeting()], next_page_token: calls === 1 ? "example-next" : "" })
    })
    const list = await recordings.list({ from: "2026-10-01", to: "2026-10-10" })
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toMatch(/signature|download_url|password|token/)
    const detail = await source(
      scripted(
        meeting([], {
          participant_audio_files: [
            file("example-audio", { file_type: "M4A", file_extension: undefined, recording_type: undefined }),
          ],
        }),
      ),
    ).show("/example//occurrence")
    expect(detail.assets[0]).toMatchObject({ id: "example-audio", format: "M4A", type: "M4A", available: true })
    const unsupported = await source(
      scripted(meeting([file("", { id: undefined, status: undefined, file_type: "CC", file_extension: undefined })])),
    ).show("example")
    expect(unsupported.assets[0]).toMatchObject({ id: null, status: "unsupported", format: "VTT", available: false })
  })
  it.each([
    { start_time: "2026-10-10T15:00:00" },
    { recording_files: [file("example-video", { recording_start: "2026-10-10T15:00:00" })] },
  ])("refuses a Zoom recording time that does not name its zone: %o", async (overrides) => {
    await expect(source(scripted(meeting([file()], overrides))).show("example")).rejects.toMatchObject({
      code: "invalid_response",
      message: "Zoom returned an invalid timestamp",
    })
  })
  it("keeps an offset Zoom time as the same UTC instant", async () => {
    const detail = await source(scripted(meeting([file()], { start_time: "2026-10-10T17:00:00+02:00" }))).show(
      "example",
    )
    expect(detail.startedAt).toBe("2026-10-10T15:00:00.000Z")
  })
  it("validates date windows, lists, ids, timestamps, file duplicates and conflicting pages", async () => {
    for (const [from, to] of [
      ["bad", "2026-10-01"],
      ["2026-02-30", "2026-03-01"],
      ["2026-10-10", "2026-10-01"],
      ["2026-01-01", "2026-03-01"],
    ])
      await expect(source(scripted()).list({ from: from ?? "", to: to ?? "" })).rejects.toThrow(/date/)
    for (const body of [
      {},
      meeting([], { uuid: "" }),
      meeting([], { id: NaN }),
      meeting([], { start_time: "bad" }),
      meeting([file(), file()]),
    ])
      await expect(source(scripted(body)).show("example")).rejects.toThrow()
    await expect(source(scripted()).show(" ")).rejects.toThrow(/id/)
    await expect(
      source(async () => response({ meetings: {} })).list({ from: "2026-10-01", to: "2026-10-10" }),
    ).rejects.toThrow(/list/)
    await expect(
      source(async () => response({ meetings: [], next_page_token: "example-loop" })).list({
        from: "2026-10-01",
        to: "2026-10-10",
      }),
    ).rejects.toThrow(/pagination/)
    let calls = 0
    await expect(
      source(async () =>
        response({
          meetings: [meeting([], { topic: calls++ ? "Changed example" : "Example" })],
          next_page_token: "example-next",
        }),
      ).list({ from: "2026-10-01", to: "2026-10-10" }),
    ).rejects.toThrow(/conflicting/)
  })
  it("streams atomically, omits signed URLs/tokens and skips only verified matching files", async () => {
    const destination = await temp()
    let downloads = 0
    const recordings = source(async (input, init) => {
      if (!String(input).includes("api.zoom.us")) downloads++
      return scripted()(input, init)
    })
    const first = await recordings.download("example", { ...scope, destination })
    expect(first.downloaded).toHaveLength(1)
    const saved = first.downloaded[0]
    expect(saved?.sha256).toBe(createHash("sha256").update("hello").digest("hex"))
    expect(JSON.stringify(await inspectArchive(destination))).not.toMatch(/signature|download_url|password|token/)
    expect(await verifyArchive(destination)).toMatchObject([{ valid: true }])
    expect((await recordings.download("example", { ...scope, destination })).skipped).toHaveLength(1)
    expect(downloads).toBe(1)
    expect((await readdir(destination)).some((name) => /\.part|\.lock|\.tmp/.test(name))).toBe(false)
    await writeFile(join(destination, saved?.path ?? ""), "other")
    expect(await verifyArchive(destination)).toMatchObject([{ valid: false }])
    await expect(recordings.download("example", { ...scope, destination })).rejects.toThrow(/changed/)
    expect(await readFile(join(destination, saved?.path ?? ""), "utf8")).toBe("other")
  })
  it("reports unavailable assets, validates selection/limits, and rejects orphan or locked destinations", async () => {
    const destination = await temp()
    const pending = source(scripted(meeting([file("example-pending", { status: "processing" })])))
    expect((await pending.download("example", { ...scope, destination })).unavailable).toHaveLength(1)
    expect(await verifyArchive(destination)).toEqual([])
    await expect(pending.download("example", { ...scope, destination, fileIds: ["unknown"] })).rejects.toThrow(
      /not found/,
    )
    for (const options of [
      { ...scope, destination: " " },
      { ...scope, destination, maxBytes: 0 },
    ])
      await expect(pending.download("example", options)).rejects.toThrow(/destination/)
    await writeFile(join(destination, ".zoom-archive.lock"), "example existing lock")
    await expect(pending.download("example", { ...scope, destination })).rejects.toThrow(/lock/)
    const other = await temp()
    const report = await source(scripted()).download("example", { ...scope, destination: other })
    const manifest = await readFile(report.manifestPath, "utf8")
    const collision = await temp()
    await writeFile(join(collision, report.downloaded[0]?.path ?? ""), "original")
    await expect(source(scripted()).download("example", { ...scope, destination: collision })).rejects.toThrow(
      /already exists/,
    )
    await writeFile(join(collision, report.manifestPath.split("/").at(-1) ?? ""), manifest)
    expect(await verifyArchive(collision)).toMatchObject([{ valid: false }])
  })
  it("blocks unsafe redirects/URLs and keeps failures free of private response text", async () => {
    for (const download_url of [
      "http://zoom.us/example",
      "https://evilzoom.us/example",
      "https://user@zoom.us/example",
      "https://zoom.us:8443/example",
      "bad",
    ])
      await expect(
        source(scripted(meeting([file("example", { download_url })]))).download("example", {
          ...scope,
          destination: await temp(),
        }),
      ).rejects.toThrow(/host/)
    let calls = 0
    await expect(
      source(async (input) => {
        if (String(input).includes("api.zoom.us")) return response(meeting())
        calls++
        return new Response(null, { status: 302, headers: { location: "https://example.com/private" } })
      }).download("example", { ...scope, destination: await temp() }),
    ).rejects.toThrow(/host/)
    expect(calls).toBe(1)
    for (const [status, headers] of [
      [302, {}],
      [302, { location: "/example-loop" }],
      [403, {}],
      [206, {}],
      [200, { "content-type": "text/html" }],
    ] as [number, Record<string, string>][]) {
      const destination = await temp()
      await expect(
        source(async (input) =>
          String(input).includes("api.zoom.us")
            ? response(meeting())
            : new Response("Private example", { status, headers }),
        ).download("example", { ...scope, destination }),
      ).rejects.toMatchObject({ code: status === 403 ? "permission_error" : "invalid_response" })
      expect(await readdir(destination)).toEqual([])
    }
  })
  it("recovers transient transfers without accepting short/oversized/partial bodies", async () => {
    let calls = 0
    const recordings = source(async (input) => {
      if (String(input).includes("api.zoom.us")) return response(meeting())
      calls++
      if (calls === 1) return new Response("Example", { status: 503 })
      return new Response("hello")
    })
    expect((await recordings.download("example", { ...scope, destination: await temp() })).downloaded).toHaveLength(1)
    expect(calls).toBe(2)
    for (const body of [
      new Response(null),
      new Response("hi"),
      new Response("hello", { headers: { "content-length": "9" } }),
      new Response("hello", { headers: { "content-length": "bad" } }),
    ]) {
      const destination = await temp()
      await expect(
        source(async (input) => (String(input).includes("api.zoom.us") ? response(meeting()) : body)).download(
          "example",
          { ...scope, destination },
        ),
      ).rejects.toMatchObject({ code: "invalid_response" })
      expect(await readdir(destination)).toEqual([])
    }
    await expect(
      source(scripted()).download("example", { ...scope, destination: await temp(), maxBytes: 4 }),
    ).rejects.toMatchObject({ code: "validation_error" })
  })
  it("rejects cancellation and malicious or symlinked local manifests/files", async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(
      source(scripted()).download("example", { ...scope, destination: await temp(), signal: abort.signal }),
    ).rejects.toThrow()
    const destination = await temp()
    const report = await source(scripted()).download("example", { ...scope, destination })
    const manifest = JSON.parse(await readFile(report.manifestPath, "utf8"))
    manifest.files[0].path = "../outside.mp4"
    await writeFile(report.manifestPath, JSON.stringify(manifest))
    await expect(inspectArchive(destination)).rejects.toThrow(/manifest/)
    const other = await temp()
    await symlink(report.manifestPath, join(other, report.manifestPath.split("/").at(-1) ?? ""))
    await expect(inspectArchive(other)).rejects.toThrow(/ordinary file/)
    await expect(inspectArchive(join(other, "absent"))).rejects.toThrow(/destination/)
  })
})

describe("safe remote requests", () => {
  it("checks actual/admin grants and classifies malformed/missing-scope/HTTP failures", async () => {
    await expect(
      new ZoomRemote(tokens([]), async () => response({})).request("/example", grants[0] ?? ""),
    ).rejects.toThrow(/scope/)
    expect(
      await new ZoomRemote(tokens([`${grants[0]}:admin`]), async () => response({})).request(
        "/example",
        grants[0] ?? "",
      ),
    ).toEqual({})
    for (const reply of [
      response({ code: 4711 }, 400),
      response({}, 401),
      new Response("Private example", { status: 403 }),
      new Response("Private example"),
      response([]),
      response({ code: 200 }),
    ])
      await expect(new ZoomRemote(tokens(), async () => reply).request("/example", grants[0] ?? "")).rejects.toThrow(
        /scope|HTTP|invalid response/,
      )
  })
  it("bounds GET retries and respects Retry-After with injected waiting", async () => {
    const delays: number[] = []
    let calls = 0
    const remote = new ZoomRemote(
      tokens(),
      async () => (++calls < 3 ? response({}, 429, { "retry-after": "1" }) : response({ ok: true })),
      {
        sleep: async (ms) => {
          delays.push(ms)
        },
        now: () => 0,
      },
    )
    expect(await remote.request("/example", grants[0] ?? "")).toEqual({ ok: true })
    expect(delays).toEqual([1000, 1000])
    await expect(
      new ZoomRemote(tokens(), async () => response({}, 503, { "retry-after": "31" }), {
        sleep: async () => {
          throw new Error("should not sleep")
        },
      }).request("/example", grants[0] ?? ""),
    ).rejects.toThrow(/HTTP 503/)
    expect(
      await remote.pause(
        new Response(null, { headers: { "retry-after": "Thu, 01 Jan 1970 00:00:01 GMT" } }),
        0,
        new AbortController().signal,
      ),
    ).toBe(true)
    let errors = 0
    await expect(
      new ZoomRemote(
        tokens(),
        async () => {
          errors++
          throw new Error("Private example")
        },
        { sleep: async () => {} },
      ).request("/example", grants[0] ?? ""),
    ).rejects.toThrow(/could not be completed/)
    expect(errors).toBe(3)
  })
})

it("retries interrupted streams with Retry-After and cancels partial output cleanly", async () => {
  const destination = await temp()
  const delays: number[] = []
  let attempts = 0
  const recordings = new ZoomRecordings(
    tokens(),
    async (input) => {
      if (String(input).includes("api.zoom.us")) return response(meeting())
      attempts++
      if (attempts === 1) return new Response(null, { status: 429, headers: { "retry-after": "2" } })
      if (attempts === 2)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("Private example stream"))
            },
          }),
        )
      return new Response("hello")
    },
    {
      sleep: async (ms) => {
        delays.push(ms)
      },
    },
  )
  expect((await recordings.download("example", { ...scope, destination })).downloaded).toHaveLength(1)
  expect(attempts).toBe(3)
  expect(delays).toEqual([2000, 500])
  const abort = new AbortController()
  const cancelled = await temp()
  let cancelledBody = false
  const stalled = source(async (input) => {
    if (String(input).includes("api.zoom.us")) return response(meeting())
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("he"))
          setTimeout(() => abort.abort(new Error("Example cancellation")), 10)
        },
        cancel() {
          cancelledBody = true
        },
      }),
    )
  })
  await expect(stalled.download("example", { ...scope, destination: cancelled, signal: abort.signal })).rejects.toThrow(
    /cancelled/,
  )
  expect(cancelledBody).toBe(true)
  expect(await readdir(cancelled)).toEqual([])
})

it("keeps verified subsets and refuses corrupted, oversized or mismatched manifests", async () => {
  const destination = await temp()
  const body = meeting([file("example-video"), file("example-audio", { file_type: "M4A", file_extension: "M4A" })])
  const recordings = source(scripted(body))
  const first = await recordings.download("example", { ...scope, destination, fileIds: ["example-video"] })
  const next = await recordings.download("example", { ...scope, destination, fileIds: ["example-audio"] })
  expect(first.downloaded).toHaveLength(1)
  expect(next.downloaded).toHaveLength(1)
  expect((await inspectArchive(destination))[0]?.files).toHaveLength(2)
  const original = JSON.parse(await readFile(first.manifestPath, "utf8"))
  const name = first.manifestPath.split("/").at(-1) ?? ""
  for (const malformed of [
    "not JSON",
    JSON.stringify({ ...original, version: 2 }),
    JSON.stringify({ ...original, signedUrl: "https://zoom.us/example?signature=example-private" }),
    JSON.stringify({
      ...original,
      meeting: { ...original.meeting, startedAt: "https://zoom.us/example?signature=example-private" },
    }),
    JSON.stringify({ ...original, files: [{ ...original.files[0], type: { signedUrl: "example-private" } }] }),
    JSON.stringify({ ...original, files: [{ ...original.files[0], format: 42 }] }),
    JSON.stringify({
      ...original,
      files: [{ ...original.files[0], remoteSize: { signedUrl: "https://zoom.us/example?signature=example-private" } }],
    }),
    JSON.stringify({ ...original, files: [original.files[0], original.files[0]] }),
    " ".repeat(1048577),
  ]) {
    await writeFile(first.manifestPath, malformed)
    await expect(inspectArchive(destination)).rejects.toThrow(/manifest/)
  }
  await writeFile(first.manifestPath, JSON.stringify(original))
  await expect(
    source(scripted(meeting([file("example-video", { file_size: 6 })]))).download("example", { ...scope, destination }),
  ).rejects.toThrow(/changed/)
  const mismatched = await temp()
  const copy = { ...original, meeting: { ...original.meeting, uuid: "other-example-occurrence" } }
  await writeFile(join(mismatched, name), JSON.stringify(copy))
  await expect(inspectArchive(mismatched)).rejects.toThrow(/manifest/)
  const normal = await temp()
  const asset = await source(scripted()).download("example", { ...scope, destination: normal })
  const unsafe = await temp()
  await writeFile(join(unsafe, name), await readFile(asset.manifestPath, "utf8"))
  await symlink(join(normal, asset.downloaded[0]?.path ?? ""), join(unsafe, asset.downloaded[0]?.path ?? ""))
  expect(await verifyArchive(unsafe)).toMatchObject([{ valid: false }])
})

it("stores supported JSON assets while rejecting JSON error bodies as video", async () => {
  const body = meeting([
    file("example-json", {
      file_type: "SUMMARY",
      file_extension: undefined,
      recording_type: undefined,
      file_size: 2,
      recording_start: null,
      recording_end: "2026-10-10T16:00:00Z",
    }),
  ])
  const recordings = source(async (input) =>
    String(input).includes("api.zoom.us")
      ? response(body)
      : new Response("{}", { headers: { "content-type": "application/json" } }),
  )
  expect((await recordings.download("example", { ...scope, destination: await temp() })).downloaded[0]?.path).toMatch(
    /\.json$/,
  )
  await expect(
    source(async (input) =>
      String(input).includes("api.zoom.us")
        ? response(meeting())
        : new Response("{}", { headers: { "content-type": "application/json" } }),
    ).download("example", { ...scope, destination: await temp() }),
  ).rejects.toThrow(/body/)
})

it("previews and repairs only unique stale local locks without removing active, foreign or unknown owners", async () => {
  const destination = await temp()
  const folder = join(destination, ".zoom-archive-locks")
  await mkdir(folder)
  const deadPid = Number(
    spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout,
  )
  expect(deadPid).toBeGreaterThan(0)
  const owner = (pid: number, host: string) => {
    const nonce = randomUUID()
    return { name: `${pid}-${nonce}.json`, content: { version: 1, pid, host, nonce } }
  }
  const stale = owner(deadPid, hostname())
  const active = owner(process.pid, hostname())
  const foreign = owner(deadPid, "example-foreign-host")
  for (const lock of [stale, active, foreign]) await writeFile(join(folder, lock.name), JSON.stringify(lock.content))
  await writeFile(join(folder, "unrecognized.json"), "Example unknown lock")
  expect((await inspectArchiveLocks(destination)).map((lock) => lock.status).sort()).toEqual([
    "active",
    "foreign",
    "stale",
    "unrecognized",
  ])
  expect((await recoverArchiveLocks(destination)).removed).toEqual([])
  const repaired = await recoverArchiveLocks(destination, { apply: true })
  expect(repaired.removed).toEqual([stale.name])
  expect((await inspectArchiveLocks(destination)).map((lock) => lock.status).sort()).toEqual([
    "active",
    "foreign",
    "unrecognized",
  ])
  await expect(source(scripted()).download("example", { ...scope, destination })).rejects.toThrow(/locked/)
  expect(await readFile(join(folder, active.name), "utf8")).toBe(JSON.stringify(active.content))
  const clean = await temp()
  await mkdir(join(clean, ".zoom-archive-locks"))
  await writeFile(join(clean, ".zoom-archive-locks", stale.name), JSON.stringify(stale.content))
  await recoverArchiveLocks(clean, { apply: true })
  expect((await source(scripted()).download("example", { ...scope, destination: clean })).downloaded).toHaveLength(1)
  expect(await inspectArchiveLocks(clean)).toEqual([])
})

it("takes over a lock left by a dead process on this machine without a manual recover", async () => {
  const destination = await temp()
  await mkdir(join(destination, ".zoom-archive-locks"))
  const deadPid = Number(
    spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout,
  )
  const nonce = randomUUID()
  await writeFile(
    join(destination, ".zoom-archive-locks", `${deadPid}-${nonce}.json`),
    JSON.stringify({ version: 1, pid: deadPid, host: hostname(), nonce }),
  )
  expect((await source(scripted()).download("example", { ...scope, destination })).downloaded).toHaveLength(1)
  expect(await inspectArchiveLocks(destination)).toEqual([])
})

it("remembers verified files so a rerun rehashes only files whose size or time changed", async () => {
  const destination = await temp()
  const first = await source(scripted()).download("example", { ...scope, destination })
  const path = first.downloaded[0]?.path as string
  const verified = JSON.parse(await readFile(join(destination, ".zoom-verified.json"), "utf8"))
  expect(Object.keys(verified.files)).toEqual([path])
  expect((await source(scripted()).download("example", { ...scope, destination })).skipped).toHaveLength(1)
  await writeFile(join(destination, path), "Example tampered bytes")
  await expect(source(scripted()).download("example", { ...scope, destination })).rejects.toThrow(/changed/)
})

it("cancels local inspection, verification and recovery without masking it as corruption", async () => {
  const destination = await temp()
  await source(scripted()).download("example", { ...scope, destination })
  const abort = new AbortController()
  abort.abort(new Error("Private example cancel"))
  for (const inspect of [inspectArchive, verifyArchive, inspectArchiveLocks])
    await expect(inspect(destination, { signal: abort.signal })).rejects.toThrowError(
      expect.objectContaining({ code: "cancelled" }),
    )
  await expect(recoverArchiveLocks(destination, { apply: true, signal: abort.signal })).rejects.toThrowError(
    expect.objectContaining({ code: "cancelled" }),
  )
  expect(await verifyArchive(destination)).toMatchObject([{ valid: true }])
})

it("interrupts streamed local verification without reporting a cancelled digest as invalid", async () => {
  const destination = await temp()
  const bytes = new Uint8Array(32 * 1024 * 1024)
  const recordings = source(async (input) =>
    String(input).includes("api.zoom.us")
      ? response(meeting([file("example-large", { file_size: bytes.length })]))
      : new Response(bytes),
  )
  await recordings.download("example", { ...scope, destination })
  const abort = new AbortController()
  const verification = verifyArchive(destination, { signal: abort.signal })
  const timer = setTimeout(() => abort.abort(), 2)
  try {
    await expect(verification).rejects.toThrowError(expect.objectContaining({ code: "cancelled" }))
  } finally {
    clearTimeout(timer)
  }
  expect(await verifyArchive(destination)).toMatchObject([{ valid: true }])
})
