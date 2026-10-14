import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  archiveRecording,
  type DownloadOptions,
  inspectArchive,
  validateDownloadOptions,
  verifyArchive,
} from "./recording-archive.js"
import type { RecordingMeeting } from "./recordings.js"
import { ZoomRemote } from "./remote-http.js"

const tokens = {
  tokens: async () => ({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    scopes: [],
    expiresAt: 3600000,
  }),
}
const meeting: RecordingMeeting = {
  id: "123456",
  uuid: "example-occurrence",
  title: "Alice Example planning",
  startedAt: null,
  assets: [
    {
      id: "example-asset",
      type: "shared_screen",
      format: "MP4",
      size: 6,
      status: "completed",
      available: true,
      startedAt: null,
      endedAt: null,
    },
  ],
}
const urls = new Map([["example-asset", "https://zoom.us/example-recording?signature=example-private"]])
const root = () => mkdtemp(join(tmpdir(), "zm-test-archive-resume-"))
const remote = (fetcher: typeof fetch, pause: () => Promise<void> = async () => {}) =>
  new ZoomRemote(tokens, fetcher, { sleep: pause })
const complete = (text = "abcdef", headers: Record<string, string> = {}) =>
  new Response(text, { headers: { "content-length": String(text.length), etag: '"example-v1"', ...headers } })
const interrupted = (prefix = "abc") => {
  let first = true
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (first) {
          first = false
          controller.enqueue(new TextEncoder().encode(prefix))
        } else controller.error(new Error("interrupted"))
      },
    }),
    { headers: { "content-length": "6", etag: '"example-v1"' } },
  )
}
describe("durable recording resume adapter", () => {
  it("resumes an interrupted transfer in the safe retry loop and verifies the final archive", async () => {
    const destination = await root()
    const requests: Headers[] = []
    const source = remote(async (_, init) => {
      const headers = new Headers(init?.headers)
      requests.push(headers)
      expect(headers.get("accept-encoding")).toBe("identity")
      expect(init?.redirect).toBe("manual")
      return requests.length === 1
        ? interrupted()
        : new Response("def", {
            status: 206,
            headers: { "content-length": "3", "content-range": "bytes 3-5/6", etag: '"example-v1"' },
          })
    })
    const report = await archiveRecording(source, meeting, urls, { destination, account: "AliceExample" })
    expect(requests.map((headers) => headers.get("range"))).toEqual([null, "bytes=3-"])
    expect(requests[1]?.get("if-range")).toBe('"example-v1"')
    expect(report.downloaded[0]?.size).toBe(6)
    expect(await verifyArchive(destination)).toMatchObject([{ valid: true }])
    const manifest = await inspectArchive(destination)
    expect(JSON.stringify(manifest)).not.toMatch(/signature|https:|token|example-access/)
  })
  it("reopens a durable prefix on the next invocation after a failed retry wait", async () => {
    const destination = await root()
    await expect(
      archiveRecording(
        remote(
          async () => interrupted(),
          async () => {
            throw new Error("stopped")
          },
        ),
        meeting,
        urls,
        { destination, account: "AliceExample" },
      ),
    ).rejects.toThrow()
    const report = await archiveRecording(
      remote(async (_, init) => {
        expect(new Headers(init?.headers).get("range")).toBe("bytes=3-")
        return new Response("def", {
          status: 206,
          headers: { "content-length": "3", "content-range": "bytes 3-5/6", etag: '"example-v1"' },
        })
      }),
      meeting,
      urls,
      { destination, account: "AliceExample" },
    )
    expect(await readFile(join(destination, report.downloaded[0]?.path ?? ""), "utf8")).toBe("abcdef")
  })
  it("restarts when the server ignores a requested range", async () => {
    const destination = await root()
    await expect(
      archiveRecording(
        remote(
          async () => interrupted(),
          async () => {
            throw new Error("stopped")
          },
        ),
        meeting,
        urls,
        { destination, account: "AliceExample" },
      ),
    ).rejects.toThrow()
    const result = await archiveRecording(
      remote(async (_, init) => {
        expect(new Headers(init?.headers).get("range")).toBe("bytes=3-")
        return complete()
      }),
      meeting,
      urls,
      { destination, account: "AliceExample" },
    )
    expect(await readFile(join(destination, result.downloaded[0]?.path ?? ""), "utf8")).toBe("abcdef")
  })
  it("validates every redirect before sending credentials or reading encoded bytes", async () => {
    const destination = await root()
    let calls = 0
    await expect(
      archiveRecording(
        remote(async () => {
          calls++
          return new Response(null, { status: 302, headers: { location: "https://example.invalid/recording" } })
        }),
        meeting,
        urls,
        { destination, account: "AliceExample" },
      ),
    ).rejects.toThrow("host")
    expect(calls).toBe(1)
    await expect(
      archiveRecording(
        remote(async () => complete("abcdef", { "content-encoding": "gzip" })),
        meeting,
        urls,
        { destination, account: "AliceExample" },
      ),
    ).rejects.toThrow("body")
    expect((await readdir(destination)).filter((name) => name.endsWith(".part"))).toEqual([])
  })
  it("requires an explicit account scope before auth or filesystem writes", async () => {
    let calls = 0
    const destination = join(await root(), "not-created")
    await expect(
      archiveRecording(
        remote(async () => {
          calls++
          return complete()
        }),
        meeting,
        urls,
        { destination, resume: true } as DownloadOptions,
      ),
    ).rejects.toThrow("scope")
    expect(calls).toBe(0)
    await expect(readdir(destination)).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("another account never reuses an account's durable prefix", async () => {
    const destination = await root()
    await expect(
      archiveRecording(
        remote(
          async () => interrupted(),
          async () => {
            throw new Error("stopped")
          },
        ),
        meeting,
        urls,
        { destination, account: "AliceExample" },
      ),
    ).rejects.toThrow()
    const result = await archiveRecording(
      remote(async (_, init) => {
        expect(new Headers(init?.headers).get("range")).toBeNull()
        return complete()
      }),
      meeting,
      urls,
      { destination, account: "BobSample" },
    )
    expect(result.downloaded[0]?.size).toBe(6)
  })
})

it("rejects malformed resume and account options before any adapter is used", () => {
  expect(() =>
    validateDownloadOptions({
      destination: "example",
      account: "AliceExample",
      resume: "true" as unknown as boolean,
    }),
  ).toThrow("boolean")
  expect(() => validateDownloadOptions({ destination: "example", account: " " })).toThrow("scope")
})

it("accepts a trusted complete-prefix 416 without reading its JSON error body", async () => {
  const destination = await root()
  await expect(
    archiveRecording(
      remote(
        async () => interrupted("abcdef"),
        async () => {
          throw new Error("stopped")
        },
      ),
      meeting,
      urls,
      { destination, account: "AliceExample" },
    ),
  ).rejects.toThrow()
  const report = await archiveRecording(
    remote(async (_, init) => {
      expect(new Headers(init?.headers).get("range")).toBe("bytes=6-")
      return new Response(JSON.stringify({ code: "example-range" }), {
        status: 416,
        headers: { "content-type": "application/json", "content-range": "bytes */6", etag: '"example-v1"' },
      })
    }),
    meeting,
    urls,
    { destination, account: "AliceExample" },
  )
  expect(report.downloaded[0]?.size).toBe(6)
  expect(await verifyArchive(destination)).toMatchObject([{ valid: true }])
})
