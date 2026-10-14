import { createUpcomingMeetingReader } from "@wirecat/cli-core/meetings"
import { expect, it } from "vitest"
import { zoomOccurrenceSchedule } from "./occurrence-schedule.js"

const after = Date.UTC(2026, 9, 14)
const until = Date.UTC(2026, 10, 14)
const read = (body: unknown, limit = 100) =>
  createUpcomingMeetingReader(
    { provider: "zoom", account: "example" },
    { read: async (id, context) => zoomOccurrenceSchedule(body, id, context.limit) },
  ).next("123", { after, until, limit })

it("normalizes a scheduled instant with an explicit offset through the shared SDK", async () => {
  const result = await read({
    id: 123,
    type: 2,
    start_time: "2026-10-14T12:00:00+02:00",
    duration: 30,
    timezone: "Europe/Madrid",
  })
  expect(result).toMatchObject({
    kind: "single",
    verifiedNext: true,
    candidate: { startAt: after + 10 * 3600000, endAt: after + 10.5 * 3600000 },
    coverage: { scheduleComplete: true },
  })
})
it("maps explicit recurring ids and deleted entries, leaving selection to Core", async () => {
  const result = await read({
    id: 123,
    type: 8,
    start_time: "2020-01-01T10:00:00Z",
    recurrence: { end_times: 3 },
    occurrences: [
      { occurrence_id: "later", start_time: "2026-10-20T10:00:00Z", duration: 30, status: "available" },
      { occurrence_id: "cancelled", start_time: "2026-10-14T08:00:00Z", status: "deleted" },
      { occurrence_id: "next", start_time: "2026-10-15T10:00:00Z", duration: 60, status: "available" },
    ],
  })
  expect(result).toMatchObject({
    kind: "recurring",
    verifiedNext: true,
    candidate: { id: "next", startAt: Date.UTC(2026, 9, 15, 10) },
    coverage: { inspected: 3, cancelled: 1, scheduleComplete: true },
  })
})
it.each([undefined, {}, { end_times: 0 }, { end_times: 2 }, { end_date_time: "2026-12-31T23:59:00Z" }])(
  "does not claim a complete recurring schedule from an array alone: %j",
  async (recurrence) => {
    const result = await read({
      id: 123,
      type: 8,
      recurrence,
      occurrences: [{ occurrence_id: "example", start_time: "2026-10-15T10:00:00Z", status: "available" }],
    })
    expect(result.candidate?.id).toBe("example")
    expect(result.verifiedNext).toBe(false)
    expect(result.coverage).toMatchObject({ scheduleComplete: false, missing: ["schedule-details"] })
  },
)
it.each([3, 8, 1, 99])(
  "never uses a series or unsupported type's top-level start as an occurrence: %s",
  async (type) => {
    const result = await read({ id: 123, type, start_time: "2026-10-15T10:00:00Z" })
    expect(result.candidate).toBeNull()
    expect(result.verifiedNext).toBe(false)
    expect(result.coverage.scheduleComplete).toBe(false)
  },
)
it("keeps missing single dates and already-started schedules unverified", async () => {
  expect(await read({ id: 123, type: 2 })).toMatchObject({
    candidate: null,
    verifiedNext: false,
    coverage: { undated: 1 },
  })
  expect(await read({ id: 123, type: 2, status: "started", start_time: "2026-10-15T10:00:00Z" })).toMatchObject({
    verifiedNext: false,
    coverage: { unverified: 1, scheduleComplete: false },
  })
})
it.each([
  "2026-02-30T10:00:00Z",
  "2026-10-15T10:00:00",
  "2026-10-15",
  "2026-10-15T25:00:00Z",
  "2026-10-15T10:00:00+25:00",
  "private-synthetic-marker",
])("refuses malformed or unzoned dates: %s", async (start_time) => {
  await expect(read({ id: 123, type: 2, start_time })).rejects.toMatchObject({
    code: "invalid_response",
    message: "Zoom meeting start_time is invalid",
  })
})
it.each([0, null, undefined])("does not invent an end when duration is unknown: %s", async (duration) => {
  expect((await read({ id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", duration })).candidate?.endAt).toBeNull()
})
it.each([-1, 0.5, "30", Infinity, Number.MAX_SAFE_INTEGER])(
  "refuses malformed or overflowing durations: %s",
  async (duration) => {
    await expect(read({ id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", duration })).rejects.toMatchObject({
      code: "invalid_response",
    })
  },
)
it("rejects mismatched ids, malformed occurrences, and insufficient row budgets", async () => {
  await expect(read({ id: 456, type: 2 })).rejects.toMatchObject({ code: "invalid_response" })
  for (const occurrence of [
    { occurrence_id: "x", status: "unknown" },
    { status: "available" },
    { occurrence_id: "\n", status: "available" },
  ])
    await expect(read({ id: 123, type: 8, occurrences: [occurrence] })).rejects.toMatchObject({
      code: "invalid_response",
    })
  const occurrence = { occurrence_id: "x", start_time: "2026-10-15T10:00:00Z", status: "available" }
  await expect(
    read({ id: 123, type: 8, occurrences: [occurrence, { ...occurrence, occurrence_id: "y" }] }, 1),
  ).rejects.toMatchObject({ code: "invalid_response" })
})
it("keeps date-ended series incomplete even when a count is also present", async () => {
  const result = await read({
    id: 123,
    type: 8,
    recurrence: { end_times: 1, end_date_time: "2026-12-31T23:59:00Z" },
    occurrences: [{ occurrence_id: "x", start_time: "2026-10-15T10:00:00Z", status: "available" }],
  })
  expect(result.verifiedNext).toBe(false)
})
it("drops unrelated provider metadata from occurrence proof", async () => {
  const result = await read({
    id: 123,
    type: 2,
    start_time: "2026-10-15T10:00:00Z",
    password: "synthetic-private-marker",
    agenda: "synthetic-private-marker",
    join_url: "https://example.invalid/private-marker",
  })
  expect(JSON.stringify(result)).not.toContain("private-marker")
})

it("keeps an undated recurring row incomplete even when the declared count matches", async () => {
  const result = await read({
    id: 123,
    type: 8,
    start_time: "2026-10-15T10:00:00Z",
    recurrence: { end_times: 1 },
    occurrences: [{ occurrence_id: "x", status: "available" }],
  })
  expect(result).toMatchObject({
    candidate: null,
    verifiedNext: false,
    coverage: { scheduleComplete: false, undated: 1 },
  })
})
it.each([-1, 0.5, "1"])(
  "rejects malformed recurrence counts instead of inferring completeness: %s",
  async (end_times) => {
    await expect(read({ id: 123, type: 8, recurrence: { end_times }, occurrences: [] })).rejects.toMatchObject({
      code: "invalid_response",
    })
  },
)
it("refuses invalid provider time zones and non-array occurrence data", async () => {
  for (const timezone of [123, "not-a-time-zone"])
    await expect(read({ id: 123, type: 2, start_time: "2026-10-15T10:00:00Z", timezone })).rejects.toMatchObject({
      code: "invalid_response",
    })
  await expect(read({ id: 123, type: 8, occurrences: {} })).rejects.toMatchObject({ code: "invalid_response" })
})
