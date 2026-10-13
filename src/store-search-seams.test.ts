import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { expect, it, vi } from "vitest"
import { createStoreConnector, type StoreConnectionOptions } from "./store-connection.js"

const mocked = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock("@wirecat/cli-core/services", () => ({ searchAllIncludingMeetings: mocked.search }))
const setup = () => ({
  meetings: Object.assign(memoryMeetingStore(), {
    appendTranscripts: vi.fn(),
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
  capability: "transcript-append" as const,
}
it("checks native append capability before account registration and closes on failure", async () => {
  const original = setup()
  const store = { ...original, meetings: { ...original.meetings, appendTranscripts: undefined } }
  // Deliberately simulate an older runtime adapter lacking the required append capability.
  const incompatible = store as unknown as Awaited<ReturnType<NonNullable<StoreConnectionOptions["openStore"]>>>
  await expect(createStoreConnector({ openStore: async () => incompatible })(request)).rejects.toMatchObject({
    code: "configuration_error",
    message: expect.stringContaining("transcript append"),
  })
  expect(store.saveAccount).not.toHaveBeenCalled()
  expect(store.close).toHaveBeenCalledOnce()
})
it("binds native append and unified search to the selected account while keeping the full store private", async () => {
  const store = setup()
  const connection = await createStoreConnector({ openStore: async () => store })(request)
  expect(() =>
    connection.appendTranscripts?.({ accountId: 99, externalId: "example", now: 1, transcripts: [] }),
  ).toThrow(/account is selected/)
  mocked.search.mockResolvedValue({ items: [], hasMore: null, searched: ["meetings"], skipped: [] })
  await connection.unifiedSearch?.({ text: "example", limit: 10 })
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
