import { Command } from "commander"
import { expect, it, vi } from "vitest"
import { addMeetingReviewCommands } from "./meeting-review-commands.js"

const setup = () => {
  const program = new Command("zm").exitOverride()
  const reader = vi.fn(async () => ({ items: [], meetings: 1, messages: 2 }))
  const links = vi.fn(async () => reader)
  const output = vi.fn()
  addMeetingReviewCommands(program, {
    review: async () => {
      throw new Error("unexpected review")
    },
    links,
    signal: () => undefined,
    output,
  })
  return { program, reader, links, output }
}
it("passes the URL predicate to the reader before limiting its answer", async () => {
  const f = setup()
  await f.program.parseAsync(["mentions", "list", 'url:"https://example.com/plan" AND project:RES', "--limit", "1"], {
    from: "user",
  })
  expect(f.reader).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com/plan", project: "RES" }))
  expect(f.output).toHaveBeenCalledWith(
    expect.objectContaining({ items: [], page: expect.objectContaining({ limit: 1 }) }),
  )
})
it("selects meetings by started_at before reading their chat", async () => {
  const f = setup()
  await f.program.parseAsync(
    ["mentions", "list", "started_at:[2026-10-01T00:00:00Z TO 2026-10-02T00:00:00Z}", "--timezone", "UTC"],
    { from: "user" },
  )
  expect(f.reader).toHaveBeenCalledWith(
    expect.objectContaining({
      since: Date.parse("2026-10-01T00:00:00Z"),
      until: Date.parse("2026-10-02T00:00:00Z") - 1,
    }),
  )
})
it("no longer takes --since-time", async () => {
  const f = setup()
  await expect(f.program.parseAsync(["mentions", "list", "--since-time", "30d"], { from: "user" })).rejects.toThrow()
  expect(f.links).not.toHaveBeenCalled()
})
it.each(["count>1", "domain:example.com", "url:a OR url:b", "started_at>=1d AND started_at<=0d", "event_id:0"])(
  "refuses unsupported %s before obtaining a reader",
  async (query) => {
    const f = setup()
    await expect(f.program.parseAsync(["mentions", "list", query], { from: "user" })).rejects.toThrow()
    expect(f.links).not.toHaveBeenCalled()
  },
)
