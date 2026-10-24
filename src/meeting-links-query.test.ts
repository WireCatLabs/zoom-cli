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
it.each(["count>1", "domain:example.com", "url:a OR url:b"])(
  "refuses unsupported %s before obtaining a reader",
  async (query) => {
    const f = setup()
    await expect(f.program.parseAsync(["mentions", "list", query], { from: "user" })).rejects.toThrow()
    expect(f.links).not.toHaveBeenCalled()
  },
)
