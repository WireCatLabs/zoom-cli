import { expect, it } from "vitest"
import { readMetadata, toolAnswer } from "./answers.js"

it("seals bare reports as one item and refuses a missing answer", () => {
  const meta = readMetadata(() => 100)()
  expect(toolAnswer(null, meta)).toEqual({ item: null, meta })
  expect(toolAnswer({ accountId: 1 }, meta)).toEqual({ item: { account_id: 1 }, meta })
  expect(() => toolAnswer(undefined, meta)).toThrow(/no answer/)
})

it("keeps report coverage and cursors together while sealing an item", () => {
  const meta = readMetadata(() => 100)()
  expect(toolAnswer({ items: [], nextCursor: "example", coverage: { currentRevisions: true } }, meta)).toEqual({
    item: { items: [], next_cursor: "example", coverage: { current_revisions: true } },
    meta,
  })
})

it("preserves standard continuation and seals empty legacy lists with a positive page limit", () => {
  const meta = readMetadata(() => 100)()
  const next = [
    {
      kind: "command",
      safe_to_auto_execute: false,
      step: "page.next",
      command: "meetings list",
      args: { cursor: "example" },
      why: "read the next page",
    },
  ]
  expect(
    toolAnswer({ items: [], page: { mode: "cursor", limit: 2, has_more: true, next_cursor: "example" }, next }, meta),
  ).toEqual({
    items: [],
    page: { mode: "cursor", limit: 2, has_more: true, next_cursor: "example" },
    next,
    meta,
  })
  expect(toolAnswer({ items: [], page: 1, limit: 0, hasMore: false }, meta)).toEqual({
    items: [],
    page: { mode: "page", limit: 1, has_more: false },
    meta,
  })
})

it("rejects malformed standard bodies and gives each execution its own metadata", () => {
  let now = 100
  const first = readMetadata(() => now)
  now = 125
  expect(first()).toMatchObject({ duration_ms: 25 })
  expect(first().run_id).not.toBe(readMetadata(() => now)().run_id)
  now = 90
  expect(first().duration_ms).toBe(0)
  expect(() => toolAnswer({ items: [], page: { mode: "page", limit: 0, has_more: false } }, first())).toThrow(
    /invalid answer/,
  )
  expect(() => toolAnswer({ item: {}, next: [{ command: "missing-step" }] }, first())).toThrow(/invalid answer/)
})
