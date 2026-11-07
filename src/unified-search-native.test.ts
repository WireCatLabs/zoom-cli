import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { openStore } from "@wirecat/cli-core/store"
import { expect, it } from "vitest"
import { createStoreConnector } from "./store-connection.js"

it("native public unified service reads only the profile's meeting account, through its index, and pages by offset", async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-native-unified-"))
  const path = join(root, "wirecat.db")
  const store = await openStore({ path })
  let selected = 0
  try {
    selected = await store.accounts.saveAccount(
      { provider: "zoom", account: "zm-profile:example" },
      { name: "Alice Example" },
    )
    const other = await store.accounts.saveAccount(
      { provider: "zoom", account: "zm-profile:other" },
      { name: "Bob Sample" },
    )
    for (const [index, accountId] of [selected, selected, other].entries()) {
      const input = sampleMeeting()
      input.meeting.accountId = accountId
      input.meeting.externalId = `example-${index}`
      input.meeting.startedAt = 3000 - index * 1000
      input.transcripts[0].rows[0].text = "Ship the example plan"
      await store.meetings.saveMeeting(input)
    }
    for (const accountId of [selected, other]) {
      let result: { remaining: number }
      do result = await store.meetings.indexSearch({ accountId, limit: 50 })
      while (result.remaining)
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
    const first = await search({ text: "Ship", limit: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.items[0]).toMatchObject({ kind: "meeting", accountId: selected })
    expect(first.hasMore).toBe(true)
    expect(first.meetings).toMatchObject([{ provider: "zoom", account: "zm-profile:example", indexing: "ready" }])
    const second = await search({ text: "Ship", limit: 1, offset: 1 })
    expect(second.items).toHaveLength(1)
    expect(second.items[0]).toMatchObject({ kind: "meeting", accountId: selected })
    expect(second.items[0]).not.toEqual(first.items[0])
    expect(second.hasMore).toBe(false)
    const phrase = await search({ text: '"Ship the example"', limit: 10 })
    expect(phrase.items).toHaveLength(2)
    expect(phrase.skipped).toEqual([])
  } finally {
    await connection.close()
  }
})
