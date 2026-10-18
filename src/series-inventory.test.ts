import { expect, it, vi } from "vitest"
import { createZoomSeriesInventoryReader } from "./series-inventory.js"

const window = { after: Date.parse("2026-10-18T00:00:00Z"), until: Date.parse("2026-10-25T00:00:00Z") }
const row = {
  id: 123,
  type: 8,
  topic: "Harbour Example",
  start_time: "2026-10-01T10:00:00Z",
  join_url: "https://example.invalid/join",
}
const setup = (body: unknown = { meetings: [row], next_page_token: "later-example" }) => {
  const resolve = vi.fn(async () => ({
    accessToken: "invented-access",
    refreshToken: "invented-refresh",
    expiresAt: 3600000,
    scopes: ["meeting:read:list_meetings"],
  }))
  const credentials = { withSignal: vi.fn((_signal?: AbortSignal) => ({ tokens: resolve })) }
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)))
  return {
    resolve,
    credentials,
    fetcher,
    reader: createZoomSeriesInventoryReader("AliceExample", credentials, fetcher),
  }
}

it("reads one scheduled page with bounded HTTP bytes and keeps old recurring hints without join links", async () => {
  const f = setup()
  expect(f.resolve).not.toHaveBeenCalled()
  const page = await f.reader.page({ ...window, limit: 2 })
  expect(f.fetcher).toHaveBeenCalledExactlyOnceWith(
    "https://api.zoom.us/v2/users/me/meetings?type=scheduled&page_size=2",
    expect.objectContaining({ redirect: "manual", headers: { authorization: "Bearer invented-access" } }),
  )
  expect(page).toMatchObject({
    items: [
      { meetingId: "123", title: "Harbour Example", kind: "recurring", scheduledStartAt: Date.parse(row.start_time) },
    ],
    coverage: {
      selection: "provider-inventory",
      dateHintsOutsideWindow: 1,
      occurrenceProof: "not-read",
      calendarCompleteness: "unknown",
    },
  })
  expect(JSON.stringify(page)).not.toContain(row.join_url)
  f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ meetings: [], next_page_token: "" })))
  const next = await f.reader.page({ ...window, limit: 2, cursor: page.nextCursor ?? undefined })
  expect(next).toMatchObject({ items: [], nextCursor: null, coverage: { hasMore: false } })
  expect(f.fetcher.mock.calls[1]?.[0]).toBe(
    "https://api.zoom.us/v2/users/me/meetings?type=scheduled&page_size=2&next_page_token=later-example",
  )
})

it("refuses invalid selection and cancellation before credentials", async () => {
  const f = setup()
  await expect(f.reader.page({ ...window, limit: 101 })).rejects.toMatchObject({ code: "validation_error" })
  const controller = new AbortController()
  controller.abort()
  await expect(f.reader.page({ ...window, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" })
  expect(f.resolve).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled()
})

it("reports the list scope and permission errors without opening another account", async () => {
  const f = setup()
  f.resolve.mockResolvedValueOnce({ accessToken: "invented", refreshToken: "invented", expiresAt: 3600000, scopes: [] })
  await expect(f.reader.page(window)).rejects.toMatchObject({
    code: "configuration_error",
    message: expect.stringContaining("meeting:read:list_meetings"),
  })
  expect(f.fetcher).not.toHaveBeenCalled()
  f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: 2306 }), { status: 403 }))
  await expect(f.reader.page(window)).rejects.toMatchObject({ code: "permission_error" })
})

it("bounds raw response reading before discarding unrelated provider fields", async () => {
  const f = setup({ meetings: [{ ...row, agenda: "x".repeat(10000) }] })
  await expect(f.reader.page({ ...window, maxReadBytes: 512 })).rejects.toMatchObject({
    code: "invalid_response",
    message: expect.stringContaining("byte budget"),
  })
  expect(f.fetcher).toHaveBeenCalledOnce()
})

it.each([
  { meetings: {} },
  { meetings: [{ ...row, id: "../123" }] },
  { meetings: [{ ...row, type: "8" }] },
  { meetings: [{ ...row, topic: "a".repeat(8193) }] },
  { meetings: [{ ...row, start_time: "2026-02-30T10:00:00Z" }] },
  { meetings: [row], next_page_token: 99 },
  { meetings: [row, { ...row, id: 456 }] },
])("refuses malformed or oversized normalized provider pages", async (body) => {
  const f = setup(body)
  await expect(f.reader.page({ ...window, limit: 1 })).rejects.toMatchObject({ code: "invalid_response" })
  expect(f.fetcher).toHaveBeenCalledOnce()
})

it("keeps undated and unknown schedule kinds explicit", async () => {
  const f = setup({
    meetings: [
      { id: "123", type: 3 },
      { id: 456, type: 1 },
      { id: 789, type: 2, start_time: "2026-10-20T10:00:00Z" },
    ],
    next_page_token: "",
  })
  const result = await f.reader.page(window)
  expect(result.items).toEqual([
    { meetingId: "123", title: null, kind: "unscheduled", scheduledStartAt: null },
    { meetingId: "456", title: null, kind: "unknown", scheduledStartAt: null },
    { meetingId: "789", title: null, kind: "single", scheduledStartAt: Date.parse("2026-10-20T10:00:00Z") },
  ])
  expect(result.coverage.undated).toBe(2)
})
