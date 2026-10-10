import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sampleMeeting } from "@wirecat/cli-meetings/testing"
import { openStore } from "@wirecat/cli-messaging/store"
import { expect, it } from "vitest"
import { createStoreConnector } from "./store-connection.js"

it("native public unified service scopes meetings, reports unsupported phrases and continues bounded scans honestly", async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-native-unified-"))
  const path = join(root, "wirecat.db")
  const store = await openStore({ path })
  let selected = 0
  try {
    selected = await store.saveAccount({ provider: "zoom", account: "zm-profile:example" }, { name: "Alice Example" })
    const other = await store.saveAccount({ provider: "zoom", account: "zm-profile:other" }, { name: "Bob Sample" })
    for (const [index, accountId] of [selected, selected, other].entries()) {
      const input = sampleMeeting()
      input.meeting.accountId = accountId
      input.meeting.externalId = `example-${index}`
      input.meeting.startedAt = 3000 - index * 1000
      input.transcripts[0].rows[0].text = "Ship the example plan"
      await store.meetings.saveMeeting(input)
    }
  } finally {
    await store.close()
  }
  const connect = createStoreConnector({ path })
  const connection = await connect({ profile: "example", externalId: "zm-profile:example", intent: "read" })
  try {
    const search = connection.unifiedSearch
    expect(search).toBeDefined()
    if (!search) throw new Error("missing public search adapter")
    const first = await search({ text: "Ship", limit: 10, maxMeetings: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.items[0]).toMatchObject({ kind: "meeting", accountId: selected })
    expect(first.hasMore).toBeNull()
    expect(first.meetings?.complete).toBe(false)
    const second = await search({ text: "Ship", limit: 10, maxMeetings: 1, meetingCursor: first.meetings?.nextCursor })
    expect(second.items).toHaveLength(1)
    expect(second.items[0]).not.toEqual(first.items[0])
    expect(second.hasMore).toBe(false)
    const unsupported = await search({ text: '"Ship the example"', limit: 10 })
    expect(unsupported.items).toEqual([])
    expect(unsupported.skipped).toMatchObject([{ resource: "meetings", reason: expect.stringContaining("phrases") }])
    await expect(
      search({
        text: "Ship",
        limit: 10,
        meetingCursor: { accountId: 99, query: "Ship", meetingOffset: 1, hitOffset: 0 },
      }),
    ).rejects.toMatchObject({ code: "validation_error" })
  } finally {
    await connection.close()
  }
})
