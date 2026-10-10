import { expect, it } from "vitest"
import { getZoomProfile } from "./recordings.js"
import { type MeetingChange, ZoomRemoteMeetings } from "./remote-meetings.js"

const scopes = [
  "meeting:read:list_meetings",
  "meeting:read:meeting",
  "meeting:read:invitation",
  "meeting:write:meeting",
  "meeting:update:meeting",
  "meeting:delete:meeting",
  "user:read:user",
]
const tokens = {
  tokens: async () => ({ accessToken: "example-access", refreshToken: "example-refresh", expiresAt: 3600000, scopes }),
}
const response = (value: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(value), { status })
const fixture = {
  id: 123456,
  uuid: "example-uuid",
  topic: "Example planning",
  type: 2,
  start_time: "2026-10-10T15:00:00Z",
  duration: 30,
  timezone: "UTC",
  agenda: "Example agenda",
  join_url: "https://zoom.us/example-room",
  start_url: "https://zoom.us/private-example-host-token",
}
const source = (fetcher: typeof fetch) => new ZoomRemoteMeetings(tokens, fetcher, { sleep: async () => {} })

it("lists and shows remote scheduled meetings, deduplicates ids and redacts host start URLs", async () => {
  let calls = 0
  const meetings = await source(async (input) => {
    const url = new URL(String(input))
    expect(url.searchParams.get("type")).toBe("upcoming")
    return response({ meetings: [fixture], next_page_token: calls++ === 0 ? "example-page" : "" })
  }).list()
  expect(meetings).toHaveLength(1)
  expect(meetings[0]).toMatchObject({ id: "123456", title: "Example planning", durationMinutes: 30 })
  expect(JSON.stringify(meetings)).not.toMatch(/start_url|host-token/)
  expect(await source(async () => response(fixture)).show("123456")).toEqual(meetings[0])
  expect(await source(async () => response({ invitation: "Example invitation" })).invitation("123456")).toEqual({
    id: "123456",
    invitation: "Example invitation",
  })
  expect(await source(async () => response({ id: "123456", duration: -1 })).show("123456")).toMatchObject({
    type: null,
    durationMinutes: null,
    agenda: null,
  })
  await expect(source(async () => response({})).invitation("123456")).rejects.toThrow(/required/)
  await expect(source(async () => response({ meetings: null })).list()).rejects.toThrow(/list/)
  await expect(source(async () => response({ meetings: [], next_page_token: "repeat" })).list()).rejects.toThrow(
    /pagination/,
  )
  for (const id of ["0", "/example//uuid", "-1", " "])
    await expect(source(async () => response({})).show(id)).rejects.toThrow(/positive numeric/)
})
it("previews every mutation without reading tokens or making requests", async () => {
  const meetings = new ZoomRemoteMeetings(
    {
      tokens: async () => {
        throw new Error("unexpected token access")
      },
    },
    async () => {
      throw new Error("unexpected request")
    },
  )
  expect(
    await meetings.create({
      topic: "Example planning",
      startTime: "2026-10-10T15:00:00+02:00",
      durationMinutes: 30,
      timezone: "Europe/Madrid",
      agenda: "",
    }),
  ).toMatchObject({
    action: "create",
    applied: false,
    request: {
      method: "POST",
      path: "/users/me/meetings",
      body: { type: 2, start_time: "2026-10-10T13:00:00.000Z", duration: 30 },
    },
  })
  expect(await meetings.create({ topic: "Example now", type: 1 }, { apply: true, dryRun: true })).toMatchObject({
    applied: false,
    request: { body: { type: 1 } },
  })
  expect(await meetings.update("123456", { topic: "Edited example", type: 2 })).toMatchObject({
    action: "update",
    applied: false,
    request: { method: "PATCH" },
  })
  expect(await meetings.cancel("123456", { occurrenceId: "example occurrence" })).toMatchObject({
    action: "cancel",
    applied: false,
    request: { method: "DELETE", path: "/meetings/123456?occurrence_id=example+occurrence" },
  })
  expect(await meetings.cancel("123456")).toMatchObject({ request: { path: "/meetings/123456" } })
})
it("applies typed changes once and never retries management requests", async () => {
  const requests: { method: string | undefined; body: string | undefined }[] = []
  const meetings = source(async (_input, init) => {
    requests.push({ method: init?.method, body: init?.body?.toString() })
    return init?.method === "POST" ? response(fixture, 201) : response(null, 204)
  })
  expect(await meetings.create({ topic: "Example", type: 1 }, { apply: true })).toMatchObject({
    applied: true,
    meeting: { id: "123456" },
  })
  expect(await meetings.update("123456", { durationMinutes: 20 }, { apply: true })).toMatchObject({ applied: true })
  expect(await meetings.cancel("123456", { apply: true })).toMatchObject({ applied: true })
  expect(requests.map((request) => request.method)).toEqual(["POST", "PATCH", "DELETE"])
  expect(requests[2]?.body).toBeUndefined()
  let calls = 0
  const failed = source(async () => {
    calls++
    throw new Error("Private example request URL")
  })
  await expect(failed.create({ topic: "Example", type: 1 }, { apply: true })).rejects.toThrow(/verify remote state/)
  expect(calls).toBe(1)
  calls = 0
  await expect(
    source(async () => {
      calls++
      return response({ message: "Private example" }, 503)
    }).create({ topic: "Example", type: 1 }, { apply: true }),
  ).rejects.toThrow(/HTTP 503/)
  expect(calls).toBe(1)
})
it("rejects unsupported, empty and malformed mutation data before network access", () => {
  const meetings = source(async () => {
    throw new Error("unexpected request")
  })
  for (const change of [
    {},
    { topic: " " },
    { topic: "Example" },
    { topic: "Example", type: 8 },
    { topic: "Example", type: 1, settings: {} },
    { topic: "Example", type: 1, startTime: "bad" },
    { topic: "Example", type: 1, startTime: "2026-02-30T15:00:00Z" },
    { topic: "Example", type: 1, startTime: "2026-02-30T15:00:00+23:59" },
    { topic: "Example", type: 1, startTime: "2026-10-10T15:00:00" },
    { topic: "Example", type: 1, durationMinutes: 0 },
    { topic: "Example", type: 1, durationMinutes: 1.5 },
    { topic: "Example", type: 1, timezone: "Invalid/Example" },
    { topic: "Example", type: 1, agenda: 3 },
  ])
    expect(() => meetings.create(change as MeetingChange)).toThrow()
  expect(() => meetings.update("123456", {})).toThrow(/at least one/)
  expect(() => meetings.cancel("123456", { occurrenceId: " " })).toThrow(/nonempty/)
})
it("fetches only the supported profile fields under the user scope and command signal", async () => {
  const signal = new AbortController().signal
  const profile = await getZoomProfile(
    tokens,
    async (input, init) => {
      expect(String(input)).toBe("https://api.zoom.us/v2/users/me")
      expect(init?.signal).toBe(signal)
      return response({
        id: "example-user",
        email: "alice@example.com",
        display_name: "Alice Example",
        zak: "example-private-token",
      })
    },
    { signal },
  )
  expect(profile).toEqual({ id: "example-user", email: "alice@example.com", displayName: "Alice Example" })
  expect(await getZoomProfile(tokens, async () => response({ id: "example-user" }))).toEqual({
    id: "example-user",
    email: null,
    displayName: null,
  })
})

it("distinguishes pre-dispatch cancellation from uncertain applied mutation results", async () => {
  const abort = new AbortController()
  let calls = 0
  const cancelled = new ZoomRemoteMeetings(
    {
      tokens: async () => {
        abort.abort(new Error("Private example abort"))
        return tokens.tokens()
      },
    },
    async () => {
      calls++
      return response(fixture)
    },
  )
  await expect(
    cancelled.create({ topic: "Example", type: 1 }, { apply: true, signal: abort.signal }),
  ).rejects.toThrowError(expect.objectContaining({ code: "cancelled" }))
  expect(calls).toBe(0)
  for (const reply of [new Response("Private example"), response([]), response({}), response({ id: "bad" })])
    await expect(source(async () => reply).create({ topic: "Example", type: 1 }, { apply: true })).rejects.toThrowError(
      expect.objectContaining({ code: "outcome_unknown" }),
    )
  const during = new AbortController()
  await expect(
    source(async () => {
      during.abort()
      throw new Error("Private example connection")
    }).create({ topic: "Example", type: 1 }, { apply: true, signal: during.signal }),
  ).rejects.toThrowError(expect.objectContaining({ code: "outcome_unknown" }))
  expect(() =>
    source(async () => response(fixture)).create({ topic: "Example", type: 1, durationMinutes: 1441 }),
  ).toThrow(/1440/)
  expect(
    (await source(async () => response(fixture)).create({ topic: "Example", type: 1, durationMinutes: 1440 })).request
      .body?.duration,
  ).toBe(1440)
})

it("preserves uncertain writes when cancellation races a successful response or body", async () => {
  for (const status of [201, 204]) {
    const abort = new AbortController()
    const meetings = source(async () => {
      abort.abort()
      return response(fixture, status)
    })
    const operation =
      status === 201
        ? meetings.create({ topic: "Example", type: 1 }, { apply: true, signal: abort.signal })
        : meetings.cancel("123456", { apply: true, signal: abort.signal })
    await expect(operation).rejects.toThrowError(expect.objectContaining({ code: "outcome_unknown" }))
  }
  const abort = new AbortController()
  const reply = response(fixture, 201)
  Object.defineProperty(reply, "json", {
    value: async () => {
      abort.abort()
      return fixture
    },
  })
  await expect(
    source(async () => reply).create({ topic: "Example", type: 1 }, { apply: true, signal: abort.signal }),
  ).rejects.toThrowError(expect.objectContaining({ code: "outcome_unknown" }))
})
