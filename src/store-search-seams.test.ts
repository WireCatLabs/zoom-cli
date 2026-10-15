import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { expect, it, vi } from "vitest"
import { fakeStore } from "../scripts/testing/connection.js"
import { createStoreConnector } from "./store-connection.js"

const mocked = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock("@wirecat/cli-core/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wirecat/cli-core/services")>()),
  searchAllIncludingMeetings: mocked.search,
}))
const setup = () => ({
  meetings: Object.assign(memoryMeetingStore(), {
    appendTranscriptsWithReceipt: vi.fn(),
    meetingMetadata: vi.fn(),
    transcriptMetadata: vi.fn(),
    transcripts: vi.fn(),
    transcriptRows: vi.fn(),
  }),
  saveAccount: vi.fn(async () => 3),
  storedAccount: vi.fn(async () => ({
    id: 3,
    provider: "zoom",
    account: "zm-profile:example",
    name: "example",
    scope: "personal" as const,
  })),
  close: vi.fn(async () => {}),
})
const request = {
  profile: "example",
  externalId: "zm-profile:example",
  intent: "ingestion" as const,
}
it("binds native append and unified search to the selected account while keeping the full store private", async () => {
  const store = setup()
  const connection = await createStoreConnector({ openStore: async () => fakeStore(store) })(request)
  expect(() =>
    connection.appendTranscriptsWithReceipt({ accountId: 99, externalId: "example", now: 1, transcripts: [] }),
  ).toThrow(/account is selected/)
  expect(store.meetings.appendTranscriptsWithReceipt).not.toHaveBeenCalled()
  mocked.search.mockResolvedValue({ items: [], hasMore: null, searched: ["meetings"], skipped: [] })
  await connection.unifiedSearch({ text: "example", limit: 10 })
  expect(mocked.search).toHaveBeenCalledWith(
    store,
    { provider: "zoom", account: "zm-profile:example" },
    expect.objectContaining({
      only: ["meetings"],
      meetingAccount: { provider: "zoom", account: "zm-profile:example" },
    }),
  )
  expect(connection).not.toHaveProperty("saveAccount")
  await connection.close()
  expect(store.close).toHaveBeenCalledOnce()
})
