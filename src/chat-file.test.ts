import { expect, it } from "vitest"
import { parseZoomChat } from "./chat-file.js"

const START = Date.parse("2026-10-20T09:00:00Z")

it("reads tabbed and spaced lines and joins a line without a time to the message before it", () => {
  const content = [
    "﻿00:01:05\tAlice Example:\tThe draft is at https://example.com/draft",
    "and the notes follow",
    "00:02:00 Bob Sample: Thanks: reading it now",
    "",
  ].join("\r\n")
  expect(parseZoomChat(content, START)).toEqual([
    {
      sentAt: "2026-10-20T09:01:05.000Z",
      sender: "Alice Example",
      text: "The draft is at https://example.com/draft\nand the notes follow",
    },
    { sentAt: "2026-10-20T09:02:00.000Z", sender: "Bob Sample", text: "Thanks: reading it now" },
  ])
})

it("takes the sender from a locally saved line and refuses text before the first message", () => {
  expect(parseZoomChat("01:00:00\tFrom Alice Example to Everyone:\tHello", START)[0]?.sender).toBe("Alice Example")
  expect(() => parseZoomChat("not a chat line", START)).toThrow(/invalid chat file/)
})
