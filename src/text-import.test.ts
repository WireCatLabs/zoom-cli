import { expect, it } from "vitest"
import { fileNamesHelp, importFile, validateDownloadedFiles } from "./files.js"

const text = `Встреча: Планёрка по релизу
Дата: Oct 21, 2026 10:30 AM
Zoom ID: 840 0000 0000
Говорят: Alice Example, Bob Sample
Реплик: 2

————————————————————————————————————————————————————————————

[00:03:12] Alice Example: Выкатываем в четверг.

[00:03:40] Bob Sample: Предупрежу поддержку.
`
const name = "2026-10-21_1030_planerka.txt"

it("keeps a .txt header's title, start, Zoom meeting id and speakers", () => {
  const file = importFile({ name, content: text }, 7, "Europe/Madrid")
  expect(file.format).toBe("text")
  expect(file.meeting.title).toBe("Планёрка по релизу")
  expect(file.meeting.startedAt).toBe(Date.parse("2026-10-21T08:30:00Z"))
  expect(file.meeting.timezone).toBe("Europe/Madrid")
  expect(file.meeting.series?.externalId).toBe("84000000000")
  expect(file.participants?.map((p) => [p.displayName, p.identity.associatePerson])).toEqual([
    ["Alice Example", false],
    ["Bob Sample", false],
  ])
  expect(file.participants?.[0]?.identity.externalId).toBe(`name:Alice Example@7/${file.meeting.externalId}:0`)
})

it("gives a .txt and a .vtt of one meeting one key, and keeps the .txt", () => {
  const vtt = {
    name: "2026-10-21_1030_planerka.vtt",
    content: "WEBVTT\n\n00:00.000 --> 00:01.000\nAlice Example: Привет\n",
  }
  expect(importFile(vtt, 7, "UTC").meeting.externalId).toBe(
    importFile({ name, content: text }, 7, "UTC").meeting.externalId,
  )
  expect(validateDownloadedFiles([vtt, { name, content: text }], "UTC").map((file) => file.name)).toEqual([name])
})

it("falls back to the file name when the header has no readable date or id", () => {
  const bare = text.replace(/^Дата: .*$/m, "Дата: —").replace(/^Zoom ID: .*$/m, "Zoom ID: —")
  const file = importFile({ name, content: bare }, 7, "UTC")
  expect(file.meeting.startedAt).toBe(Date.parse("2026-10-21T10:30:00Z"))
  expect(file.meeting.series?.externalId).toBe("file:planerka")
})

it("explains the file names and the zone their time is read in", () => {
  expect(fileNamesHelp(() => ({ filesTimezone: "Asia/Tokyo" }))).toContain("files.timezone, now Asia/Tokyo")
  expect(fileNamesHelp(() => ({ filesTimezone: null }))).toContain("this computer's zone, now")
  expect(
    fileNamesHelp(() => {
      throw new Error("unreadable config")
    }),
  ).toContain("files.timezone, else this computer's zone")
})
