import { mkdtemp, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { ZoomApiSource } from "./api.js"
import { FilesSource, fileMeeting, readDownloadedFiles, validateDownloadedFiles } from "./files.js"
import { TokenManager } from "./tokens.js"

const scopes = [
  "meeting:read:list_meetings",
  "meeting:read:list_past_instances",
  "meeting:read:list_past_participants",
  "cloud_recording:read:meeting_transcript",
  "meeting:read:summary",
]
const tokens = () => {
  const manager = new TokenManager({
    clientId: "example-client",
    keyring: memoryKeyring(),
    service: "example",
    fetch,
    now: () => 0,
  })
  manager.save({ accessToken: "example-access", refreshToken: "example-refresh", expiresAt: 3600000, scopes })
  return manager
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAlice Example: Example plan\n"

describe("source regressions", () => {
  it("disables automatic redirects and refuses to send bearer credentials to another host", async () => {
    const calls: string[] = []
    const source = new ZoomApiSource(tokens(), async (input, init) => {
      calls.push(String(input))
      if (String(input).includes("/transcript")) return response({ download_url: "https://zoom.us/example-file" })
      expect(init?.redirect).toBe("manual")
      return new Response(null, { status: 302, headers: { location: "https://example.com/private-file" } })
    })
    await expect(source.transcript("example-meeting")).rejects.toThrow(/host/)
    expect(calls).toHaveLength(2)
  })
  it("classifies non-JSON error and transport replies without exposing their content", async () => {
    for (const [reply, pattern] of [
      [new Response("private example", { status: 429 }), /HTTP 429/],
      [new Response("private example"), /invalid response/],
    ] as const) {
      await expect(new ZoomApiSource(tokens(), async () => reply).participants("example")).rejects.toThrow(pattern)
    }
    await expect(
      new ZoomApiSource(tokens(), async () => {
        throw new Error("private example URL")
      }).participants("example"),
    ).rejects.toThrow("Zoom request could not be completed")
  })
  it("deduplicates stable participant sessions across pages and rejects negative duration", async () => {
    let calls = 0
    const row = {
      id: "example-person",
      user_id: "example-session",
      name: "Alice Example",
      duration: 10,
      join_time: "2026-10-10T00:00:00Z",
    }
    const source = new ZoomApiSource(tokens(), async () =>
      response({
        participants: calls++
          ? [row, { ...row, user_id: "example-session-two", join_time: "2026-10-10T00:01:00Z", duration: -4 }]
          : [row],
        next_page_token: calls === 1 ? "example-page" : "",
      }),
    )
    const [person] = await source.participants("example")
    expect(person?.durationMs).toBe(10000)
    expect(person?.sessions).toHaveLength(2)
  })
  it("uses empty unified content rather than resurrecting legacy sections", async () => {
    const summary = await new ZoomApiSource(tokens(), async () =>
      response({
        summary_content: "",
        summary_details: [{ label: "Old", summary: "Obsolete example" }],
        next_steps: ["Obsolete example"],
      }),
    ).summary("example")
    expect(summary?.content).toBe("")
    expect(summary?.sections).toEqual([])
    expect(summary?.nextSteps).toEqual([])
  })
  it("rejects conflicting files that normalize to the same occurrence instead of choosing arbitrarily", async () => {
    const source = new FilesSource([
      { name: "2026-10-10_1530_example.vtt", content: vtt },
      { name: "2026-10-10_1530_example.VTT", content: `${vtt}\nExtra example` },
    ])
    await expect(source.meetings("2026-10-01")).rejects.toThrow(/conflicting/)
  })
  it("returns a classified validation error for an invalid timezone", () => {
    expect(() => fileMeeting("2026-10-10_1530_example.vtt", "Invalid/Example")).toThrowError(
      expect.objectContaining({ code: "validation_error" }),
    )
  })
})

it("follows only validated redirects with a shared deadline", async () => {
  const signals: (AbortSignal | null | undefined)[] = []
  const source = new ZoomApiSource(tokens(), async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.includes("/transcript")) return response({ download_url: "https://zoom.us/example-start" })
    signals.push(init?.signal)
    expect(init?.redirect).toBe("manual")
    expect(init?.headers).toHaveProperty("authorization", "Bearer example-access")
    return url.pathname === "/example-start"
      ? new Response(null, { status: 307, headers: { location: "/example-end" } })
      : new Response(vtt)
  })
  expect(await source.transcript("example")).toHaveLength(1)
  expect(signals).toHaveLength(2)
  expect(signals[0]).toBe(signals[1])
})

it("bounds redirect loops and rejects missing, malformed and nonstandard targets", async () => {
  for (const location of [null, "/example-loop"] as const) {
    let downloads = 0
    const source = new ZoomApiSource(tokens(), async (input) => {
      if (String(input).includes("/transcript")) return response({ download_url: "https://zoom.us/example-loop" })
      downloads++
      return new Response("example", { status: 302, headers: location ? { location } : {} })
    })
    await expect(source.transcript("example")).rejects.toThrow(/redirects/)
    expect(downloads).toBeLessThanOrEqual(6)
  }
  for (const target of ["invalid example", "https://zoom.us:8443/example", "https://user:password@zoom.us/example"])
    await expect(
      new ZoomApiSource(tokens(), async () => response({ download_url: target })).transcript("example"),
    ).rejects.toThrow(/host/)
})

it("rejects invalid, oversized and failed transcript bodies with safe errors", async () => {
  const bodies = [
    new Response("<html>Private example login page</html>"),
    new Response("WEBVTT\n\nprivate example\nPrivate example text\n"),
    new Response(null),
    new Response(new Uint8Array(10 * 1024 * 1024 + 1)),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("Private example URL"))
        },
      }),
    ),
  ]
  for (const body of bodies) {
    const source = new ZoomApiSource(tokens(), async (input) =>
      String(input).includes("/transcript") ? response({ download_url: "https://zoom.us/example-body" }) : body,
    )
    await expect(source.transcript("example")).rejects.toThrow(/invalid transcript|size limit|could not be completed/)
  }
  const source = new ZoomApiSource(tokens(), async (input) => {
    if (String(input).includes("/transcript")) return response({ download_url: "https://zoom.us/example-body" })
    throw new Error("Private example URL")
  })
  await expect(source.transcript("example")).rejects.toThrow("Transcript download could not be completed")
})

it("collapses identical normalized files and supports deterministic repeated calls", async () => {
  const files = [
    { name: "2026-10-10_1530_Cafe\u0301.vtt", content: vtt },
    { name: "2026-10-10_1530_Café.VTT", content: vtt },
  ]
  const source = new FilesSource(files)
  const meetings = await source.meetings("2026-10-01")
  expect(meetings).toHaveLength(1)
  expect(await source.meetings("2026-10-01")).toEqual(meetings)
  expect(await source.transcript(meetings[0]?.occurrence.id ?? "")).toHaveLength(1)
  expect(fileMeeting("2026-04-05_0100_example.vtt", "Australia/Lord_Howe").occurrence.startedAt).toBe(
    "2026-04-04T14:00:00.000Z",
  )
  expect(() => fileMeeting("2026-04-05_0145_example.vtt", "Australia/Lord_Howe")).toThrow(/ambiguous/)
  expect(() => fileMeeting("2026-10-04_0215_example.vtt", "Australia/Lord_Howe")).toThrow(/nonexistent/)
})

it("preserves HTTP failures when an endpoint has no missing-resource code", async () => {
  await expect(
    new ZoomApiSource(tokens(), async () => new Response("", { status: 404 })).participants("example"),
  ).rejects.toThrow(/HTTP 404/)
  for (const reply of [response([], 503), response(null, 500)])
    await expect(new ZoomApiSource(tokens(), async () => reply).participants("example")).rejects.toThrow(/HTTP 50/)
})

it("validates series ids and keeps invalid scheduled durations unknown", async () => {
  for (const id of [" ", -1, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      new ZoomApiSource(tokens(), async () => response({ meetings: [{ id }] })).meetings("2026-10-01"),
    ).rejects.toThrow(/series id/)
  for (const duration of [-1, Number.MAX_VALUE]) {
    const [meeting] = await new ZoomApiSource(tokens(), async () =>
      response({
        meetings: [{ id: "example-series", uuid: "example-occurrence", start_time: "2026-10-10T00:00:00Z", duration }],
      }),
    ).meetings("2026-10-01")
    expect(meeting?.occurrence.endedAt).toBeNull()
  }
})

it("deduplicates recurring occurrence UUIDs and includes the exact since boundary", async () => {
  const source = new ZoomApiSource(tokens(), async (input) =>
    String(input).includes("/instances")
      ? response({
          meetings: [
            { uuid: "/example//uuid", start_time: "2026-10-10T00:00:00Z" },
            { uuid: "/example//uuid", start_time: "2026-10-10T00:00:00Z" },
            { uuid: "example-old", start_time: "2026-10-09T23:59:59Z" },
          ],
        })
      : response({ meetings: [{ id: "example-series", type: 3 }] }),
  )
  const meetings = await source.meetings("2026-10-10T00:00:00Z")
  expect(meetings).toHaveLength(1)
  expect(meetings[0]?.occurrence.id).toBe("/example//uuid")
  await expect(
    new ZoomApiSource(tokens(), async (input) =>
      String(input).includes("/instances")
        ? response({ meetings: null })
        : response({ meetings: [{ id: "example-series", type: 8 }] }),
    ).meetings("2026-10-01"),
  ).rejects.toThrow(/occurrences/)
})

it("uses edited legacy detail text without restoring the original sections or overview", async () => {
  const source = new ZoomApiSource(tokens(), async () =>
    response({
      edited_summary: {
        summary_details: "Edited example",
        summary_overview: "",
        next_steps: ["Edited example next step"],
      },
      summary_overview: "Obsolete example overview",
      summary_details: [{ label: "Obsolete", summary: "Obsolete example details" }],
    }),
  )
  const summary = await source.summary("example")
  expect(summary?.content).toBe("Edited example")
  expect(summary?.overview).toBe("")
  expect(summary?.sections).toEqual([])
  expect(summary?.nextSteps).toEqual(["Edited example next step"])
})

it("preserves shared-parser compatibility with lone CR WebVTT line endings", async () => {
  const source = new ZoomApiSource(tokens(), async (input) =>
    String(input).includes("/transcript")
      ? response({ download_url: "https://zoom.us/example-cr" })
      : new Response(vtt.replaceAll("\n", "\r")),
  )
  expect(await source.transcript("example")).toHaveLength(1)
})

it("refuses a folder transcript larger than zm downloads, before reading it", async () => {
  const folder = await mkdtemp(join(tmpdir(), "zm-test-source-"))
  const name = "2026-10-10_1530_example.vtt"
  await writeFile(join(folder, name), vtt)
  await truncate(join(folder, name), 10 * 1024 ** 2 + 1)
  await expect(readDownloadedFiles(folder)).rejects.toThrow(/larger than 10 MiB/)
})

it("preflights actual folder imports and injected files before choosing normalized contents", async () => {
  const folder = await mkdtemp(join(tmpdir(), "zm-test-source-"))
  const name = "2026-10-10_1530_example.vtt"
  await writeFile(join(folder, name), vtt)
  await writeFile(join(folder, name.replace(".vtt", ".VTT")), `${vtt}\nChanged example`)
  await expect(readDownloadedFiles(folder)).rejects.toThrow(/conflicting/)
  await writeFile(join(folder, name.replace(".vtt", ".VTT")), vtt)
  expect(await readDownloadedFiles(folder)).toHaveLength(1)
  expect(
    validateDownloadedFiles(
      [
        { name, content: vtt },
        { name: name.replace(".vtt", ".VTT"), content: vtt },
      ],
      "Europe/Madrid",
    ),
  ).toHaveLength(1)
  expect(() => validateDownloadedFiles([{ name: "bad.vtt", content: vtt }])).toThrow(/expected a transcript/)
})
