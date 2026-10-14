import { memoryKeyring } from "@wirecat/cli-base"
import { expect, it, vi } from "vitest"
import { ZoomRemote } from "./remote-http.js"
import { TokenManager } from "./tokens.js"
import { createZoomUpcomingMeetingReader } from "./upcoming-meetings.js"

const window = { after: Date.UTC(2026, 9, 14), until: Date.UTC(2026, 10, 14) }
const body = { id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", duration: 30 }
const token = {
  accessToken: "example-access",
  refreshToken: "example-refresh",
  expiresAt: 3600000,
  scopes: ["meeting:read:meeting"],
}
const setup = (response: () => Response = () => new Response(JSON.stringify(body))) => {
  const resolve = vi.fn(async () => ({ ...token }))
  const fetcher = vi.fn<typeof fetch>(async () => response())
  const credentials = { withSignal: vi.fn((_signal?: AbortSignal) => ({ tokens: resolve })) }
  const sdk = createZoomUpcomingMeetingReader("example", credentials, fetcher, { sleep: async () => {} })
  return { sdk, resolve, fetcher, credentials }
}
it("opens no credentials until a valid read and binds trusted HTTP to the shared SDK", async () => {
  const f = setup()
  expect(f.resolve).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled()
  const result = await f.sdk.next("123", window)
  expect(result).toMatchObject({
    scope: { provider: "zoom", account: "example" },
    verifiedNext: true,
    candidate: { startAt: Date.UTC(2026, 9, 15, 10) },
  })
  expect(f.resolve).toHaveBeenCalledOnce()
  expect(f.fetcher).toHaveBeenCalledWith(
    "https://api.zoom.us/v2/meetings/123",
    expect.objectContaining({ redirect: "manual", headers: { authorization: "Bearer example-access" } }),
  )
})
it("refuses invalid provider ids, bounds and cancellation before credentials", async () => {
  const f = setup()
  for (const id of ["../123", "0", "-1", "123?next=other"])
    await expect(f.sdk.next(id, window)).rejects.toMatchObject({ code: "validation_error" })
  await expect(f.sdk.next("123", { ...window, maxReadBytes: 0 })).rejects.toMatchObject({ code: "validation_error" })
  const abort = new AbortController()
  abort.abort()
  await expect(f.sdk.next("123", { ...window, signal: abort.signal })).rejects.toMatchObject({ code: "cancelled" })
  expect(f.resolve).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled()
})
it("reports the required scope without fetching or opening another login", async () => {
  const f = setup()
  f.resolve.mockResolvedValue({ ...token, scopes: [] })
  await expect(f.sdk.next("123", window)).rejects.toMatchObject({
    code: "configuration_error",
    message: expect.stringContaining("meeting:read:meeting"),
  })
  expect(f.fetcher).not.toHaveBeenCalled()
})
it("bounds bytes before parsing even when provider metadata would later be discarded", async () => {
  const f = setup(
    () => new Response(JSON.stringify({ ...body, agenda: "x".repeat(10000) }), { headers: { "content-length": "1" } }),
  )
  await expect(f.sdk.next("123", { ...window, maxReadBytes: 512 })).rejects.toMatchObject({
    code: "invalid_response",
    message: expect.stringContaining("byte budget"),
  })
  expect(f.fetcher).toHaveBeenCalledOnce()
})
it("refuses malformed UTF-8 and mismatched selected meeting ids", async () => {
  for (const response of [
    () =>
      new Response(
        Buffer.concat([
          Buffer.from('{"id":123,"type":2,"start_time":"2026-10-15T10:00:00Z","agenda":"'),
          Buffer.from([0xff]),
          Buffer.from('"}'),
        ]),
      ),
    () => new Response(JSON.stringify({ ...body, id: 456 })),
  ])
    await expect(setup(response).sdk.next("123", window)).rejects.toMatchObject({ code: "invalid_response" })
})
it("keeps the captured credential resolver and one token through HTTP retries", async () => {
  const initial = vi.fn(async () => ({ ...token }))
  const scoped = vi.fn((_signal?: AbortSignal) => ({ tokens: initial }))
  const auth = { withSignal: scoped }
  let attempt = 0
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: attempt++ ? 200 : 503 }))
  const sdk = createZoomUpcomingMeetingReader("example", auth, fetcher, { sleep: async () => {} })
  auth.withSignal = vi.fn(() => ({ tokens: vi.fn(async () => ({ ...token, accessToken: "changed-example-access" })) }))
  expect((await sdk.next("123", window)).verifiedNext).toBe(true)
  expect(initial).toHaveBeenCalledOnce()
  expect(auth.withSignal).not.toHaveBeenCalled()
  expect(scoped).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(
    fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).get("authorization") === "Bearer example-access"),
  ).toBe(true)
})
it("cancels a response when interruption follows HTTP dispatch", async () => {
  const controller = new AbortController()
  const cancel = vi.fn()
  const response = new Response(new ReadableStream({ cancel }))
  const fetcher: typeof fetch = async () => {
    controller.abort()
    return response
  }
  const sdk = createZoomUpcomingMeetingReader(
    "example",
    { withSignal: () => ({ tokens: async () => ({ ...token }) }) },
    fetcher,
  )
  await expect(sdk.next("123", { ...window, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" })
  expect(cancel).toHaveBeenCalledOnce()
  expect(response.body?.locked).toBe(false)
})
it("preserves provider permission failures without exposing provider message values", async () => {
  const f = setup(
    () => new Response(JSON.stringify({ code: 200, message: "synthetic-private-provider-marker" }), { status: 403 }),
  )
  await expect(f.sdk.next("123", window)).rejects.toMatchObject({
    code: "permission_error",
    message: "Zoom request failed (HTTP 403, code 200)",
  })
})
it("validates bounded transport options before credentials or mutation dispatch", async () => {
  const f = setup()
  const remote = new ZoomRemote({ tokens: f.resolve }, f.fetcher)
  for (const maxResponseBytes of [0, -1, Infinity, 1.5])
    await expect(remote.request("/meetings/123", "meeting:read:meeting", { maxResponseBytes })).rejects.toMatchObject({
      code: "validation_error",
    })
  await expect(
    remote.request("/meetings/123", "meeting:write:meeting", { method: "POST", maxResponseBytes: 100 }),
  ).rejects.toMatchObject({ code: "validation_error" })
  expect(f.resolve).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled()
})

it("binds credential refresh to the operation signal and preserves uncertain refresh outcomes", async () => {
  const controller = new AbortController()
  const refresh = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.signal?.aborted).toBe(false)
    controller.abort()
    expect(init?.signal?.aborted).toBe(true)
    throw new DOMException("synthetic cancellation", "AbortError")
  })
  const manager = new TokenManager({
    clientId: "example",
    service: "example",
    keyring: memoryKeyring(),
    fetch: refresh,
    now: () => 0,
  })
  manager.save({ ...token, expiresAt: 0 })
  const api = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)))
  const sdk = createZoomUpcomingMeetingReader("example", manager, api)
  await expect(sdk.next("123", { ...window, signal: controller.signal })).rejects.toMatchObject({
    code: "outcome_unknown",
  })
  expect(refresh).toHaveBeenCalledOnce()
  expect(api).not.toHaveBeenCalled()
})

it("reports an unavailable credential capability without constructing a request", () => {
  const fetcher = vi.fn<typeof fetch>()
  expect(() => createZoomUpcomingMeetingReader("example", {} as never, fetcher)).toThrow("credential scope")
  expect(fetcher).not.toHaveBeenCalled()
})
