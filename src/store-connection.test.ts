import { CliError } from "@wirecat/cli-core"
import { memoryMeetingStore } from "@wirecat/cli-meetings/testing"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ZoomError } from "./errors.js"
import type { StoreConnectRequest } from "./program.js"
import { createStoreConnector } from "./store-connection.js"

const mocked = vi.hoisted(() => ({ openStore: vi.fn(), loaded: vi.fn() }))
vi.mock("@wirecat/cli-messaging/store", () => {
  mocked.loaded()
  return { openStore: mocked.openStore }
})
const request = { profile: "example", externalId: "zm-profile:example", intent: "read" as const }
const fixture = () => ({
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
beforeEach(() => {
  mocked.openStore.mockReset()
})

describe("persistent account connector", () => {
  it("imports the store lazily and resolves existing read accounts without registration", async () => {
    const store = fixture()
    mocked.openStore.mockResolvedValue(store)
    const connect = createStoreConnector()
    expect(mocked.loaded).not.toHaveBeenCalled()
    expect(mocked.openStore).not.toHaveBeenCalled()
    const connection = await connect(request)
    expect(mocked.loaded).toHaveBeenCalledOnce()
    expect(mocked.openStore).toHaveBeenCalledWith({ path: undefined, env: undefined, now: undefined })
    expect(store.storedAccount).toHaveBeenCalledWith({ provider: "zoom", account: "zm-profile:example" })
    expect(store.saveAccount).not.toHaveBeenCalled()
    expect(connection.accountId).toBe(3)
    expect(connection.store).toBe(store.meetings)
    expect(store.close).not.toHaveBeenCalled()
    await connection.close()
    expect(store.close).toHaveBeenCalledOnce()
  })
  it("registers ingestion profiles using the supported API and forwards explicit paths/clock", async () => {
    const store = fixture()
    const openStore = vi.fn(async () => store)
    const env = { MESSAGING_STORE: "/tmp/zm-test-injected-only/wirecat.db" }
    const now = () => 1000
    const connection = await createStoreConnector({
      path: "/tmp/zm-test-injected-only/wirecat.db",
      env,
      now,
      openStore,
    })({ ...request, intent: "ingestion" })
    expect(openStore).toHaveBeenCalledWith({ path: env.MESSAGING_STORE, env, now })
    expect(store.saveAccount).toHaveBeenCalledWith(
      { provider: "zoom", account: "zm-profile:example" },
      { name: "example" },
    )
    expect(store.storedAccount).not.toHaveBeenCalled()
    expect(connection.accountId).toBe(3)
    await connection.close()
    expect(store.close).toHaveBeenCalledOnce()
  })
  it("closes missing-account setup without registering or exposing provider error values", async () => {
    const store = fixture()
    store.storedAccount.mockRejectedValue(new CliError("not_found", "example-private-account"))
    await expect(createStoreConnector({ openStore: async () => store })(request)).rejects.toMatchObject({
      code: "configuration_error",
      message: "no stored meetings for the selected profile; import transcripts or pull first",
    })
    expect(store.close).toHaveBeenCalledOnce()
    expect(store.saveAccount).not.toHaveBeenCalled()
  })
  it("preserves primary setup errors when close fails and sanitizes unknown failures", async () => {
    const store = fixture()
    store.saveAccount.mockRejectedValue(new Error("example-private-path"))
    store.close.mockRejectedValue(new Error("example-private-close"))
    await expect(
      createStoreConnector({ openStore: async () => store })({ ...request, intent: "ingestion" }),
    ).rejects.toMatchObject({
      code: "configuration_error",
      message: expect.stringContaining("installed store version"),
    })
    expect(store.close).toHaveBeenCalledOnce()
    await expect(
      createStoreConnector({
        openStore: async () => {
          throw new Error("example-native-load-detail")
        },
      })(request),
    ).rejects.toMatchObject({ code: "configuration_error" })
  })
  it("rejects invalid numeric account IDs and closes before returning failure", async () => {
    for (const id of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const store = fixture()
      store.saveAccount.mockResolvedValue(id)
      await expect(
        createStoreConnector({ openStore: async () => store })({ ...request, intent: "ingestion" }),
      ).rejects.toMatchObject({ code: "configuration_error", message: "the selected meeting account is unavailable" })
      expect(store.close).toHaveBeenCalledOnce()
    }
  })
  it("preserves typed configuration errors without an extra close if opening fails", async () => {
    const error = new ZoomError("configuration_error", "test connection was rejected")
    await expect(
      createStoreConnector({
        openStore: async () => {
          throw error
        },
      })(request),
    ).rejects.toBe(error)
  })

  it("rejects invalid profile, key and intent before importing or opening the store", async () => {
    const openStore = vi.fn()
    for (const invalid of [
      { ...request, profile: "" },
      { ...request, profile: "../invented" },
      { ...request, profile: "a".repeat(65) },
      { ...request, externalId: "zm-profile:another" },
      { ...request, externalId: "invented-unscoped" },
      { ...request, intent: "write" },
    ])
      await expect(createStoreConnector({ openStore })(invalid as StoreConnectRequest)).rejects.toMatchObject({
        code: "validation_error",
      })
    expect(openStore).not.toHaveBeenCalled()
  })

  it("rejects invalid IDs from the read lookup without account registration", async () => {
    for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const store = fixture()
      store.storedAccount.mockResolvedValue({
        id,
        provider: "zoom",
        account: request.externalId,
        name: "example",
        scope: "personal",
      })
      await expect(createStoreConnector({ openStore: async () => store })(request)).rejects.toMatchObject({
        code: "configuration_error",
        message: "the selected meeting account is unavailable",
      })
      expect(store.saveAccount).not.toHaveBeenCalled()
      expect(store.close).toHaveBeenCalledTimes(1)
    }
  })

  it("keeps the missing-profile guidance when its setup close also fails", async () => {
    const store = fixture()
    store.storedAccount.mockRejectedValue(new CliError("not_found", "invented-private-account"))
    store.close.mockRejectedValue(new Error("invented-private-close"))
    await expect(createStoreConnector({ openStore: async () => store })(request)).rejects.toMatchObject({
      code: "configuration_error",
      message: "no stored meetings for the selected profile; import transcripts or pull first",
    })
    expect(store.close).toHaveBeenCalledTimes(1)
    expect(store.saveAccount).not.toHaveBeenCalled()
  })
})
