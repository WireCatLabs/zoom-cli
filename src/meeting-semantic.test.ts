import type { MeetingEmbedder, MeetingEmbeddingModel } from "@wirecat/cli-core/services"
import type { MeetingVectors } from "@wirecat/cli-core/store"
import { expect, it, vi } from "vitest"
import { createMeetingSemanticCapabilities } from "./meeting-semantic.js"

const fixture = () => {
  const vectors = {
    rebuild: vi.fn(async () => ({ transcripts: 1, chunks: 2, hasMore: true, nextTranscriptId: 20 })),
    chunksToEmbed: vi.fn(),
    nearest: vi.fn(),
    status: vi.fn(),
    saveCurrent: vi.fn(),
    ranked: vi.fn(),
  } satisfies MeetingVectors
  const descriptor = {
    key: "local:example:2",
    dims: 2,
    kind: "local" as const,
    model: "example",
  } satisfies MeetingEmbeddingModel
  const embedder = { ...descriptor, embed: vi.fn(), close: vi.fn(async () => {}) } satisfies MeetingEmbedder
  const api = {
    meetingEmbeddingModel: vi.fn(() => descriptor),
    createMeetingRemoteModel: vi.fn((input: { model?: string; baseUrl?: string; dims?: number }) => ({
      provider: "url:example.invalid",
      model: input.model ?? "example",
      dims: input.dims ?? 2,
      baseUrl: input.baseUrl ?? "https://example.invalid/v1",
      shorten: false,
    })),
    openMeetingEmbedder: vi.fn(async () => embedder),
    searchMeetingsCombined: vi.fn(async () => ({
      items: [],
      hasMore: false,
      nextCursor: null,
      selection: [],
      words: { query: "example" },
      model: descriptor,
      coverage: {
        archiveCompleteness: "unknown" as const,
        indexCompleteness: "unknown" as const,
        indexing: "ready" as const,
        meaningScanComplete: false,
        scanned: 0,
        depth: 200,
      },
    })),
    proposeMeetingEmbedding: vi.fn(async () => ({
      accountId: 3,
      model: descriptor,
      applied: false as const,
      status: { chunks: 2, embedded: 0 },
      scope: "existing-current-chunks" as const,
      rebuildRequired: "explicit" as const,
    })),
    applyMeetingEmbedding: vi.fn(async () => ({
      accountId: 3,
      model: descriptor,
      saved: 1,
      skipped: 1,
      hasMore: true,
      nextHash: "a".repeat(64),
    })),
  }
  const load = vi.fn(async () => api)
  const store = { meetingVectors: vectors, meetings: {} as never }
  return { vectors, store, descriptor, embedder, api, load }
}

it("previews existing vector counts without opening a model or rebuilding transcript chunks", async () => {
  const { vectors, store, descriptor, api, load } = fixture()
  const capability = createMeetingSemanticCapabilities(store, 3, { load })
  expect(await capability.generate({ model: "example" })).toMatchObject({
    applied: false,
    status: { chunks: 2, embedded: 0 },
  })
  expect(api.proposeMeetingEmbedding).toHaveBeenCalledWith(vectors, 3, descriptor, { signal: undefined })
  expect(api.openMeetingEmbedder).not.toHaveBeenCalled()
  expect(api.applyMeetingEmbedding).not.toHaveBeenCalled()
  expect(vectors.rebuild).not.toHaveBeenCalled()
  expect(vectors.saveCurrent).not.toHaveBeenCalled()
})

it("scopes query reads to the connection account and closes the model on producer failure", async () => {
  const { vectors, store, embedder, api, load } = fixture()
  const capability = createMeetingSemanticCapabilities(store, 3, { load })
  api.searchMeetingsCombined.mockRejectedValue(new Error("example query failure"))
  await expect(capability.search("example", { model: "example", after: "example-cursor" })).rejects.toThrow(
    "example query failure",
  )
  expect(api.searchMeetingsCombined).toHaveBeenCalledWith(
    store,
    embedder,
    "example",
    expect.objectContaining({ accountId: 3, after: "example-cursor" }),
  )
  expect(embedder.close).toHaveBeenCalledOnce()
  expect(vectors.rebuild).not.toHaveBeenCalled()
  expect(api.applyMeetingEmbedding).not.toHaveBeenCalled()
})

it("applies only an explicit bounded generation batch and retains producer continuation and rebuild coverage", async () => {
  const { vectors, store, embedder, api, load } = fixture()
  const capability = createMeetingSemanticCapabilities(store, 3, { load })
  const result = await capability.generate({
    model: "example",
    yes: true,
    limit: 2,
    afterTranscriptId: 15,
    maxRows: 20,
    maxTextBytes: 1000,
  })
  expect(vectors.rebuild).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: 3, limit: 2, afterTranscriptId: 15, maxRows: 20, maxTextBytes: 1000 }),
  )
  expect(api.applyMeetingEmbedding).toHaveBeenCalledWith(
    vectors,
    3,
    embedder,
    expect.objectContaining({ maxChunks: 2, maxRows: 20, maxTextBytes: 1000 }),
  )
  expect(result).toMatchObject({
    applied: true,
    saved: 1,
    skipped: 1,
    hasMore: true,
    nextHash: "a".repeat(64),
    rebuild: { hasMore: true, nextTranscriptId: 20 },
  })
  expect(embedder.close).toHaveBeenCalledOnce()
})

it("leaves stored chunks unchanged when the explicit generation model cannot open", async () => {
  const { vectors, store, api, load } = fixture()
  api.openMeetingEmbedder.mockRejectedValue(new Error("example model unavailable"))
  const capability = createMeetingSemanticCapabilities(store, 3, { load })
  await expect(capability.generate({ model: "example", yes: true })).rejects.toThrow("example model unavailable")
  expect(vectors.rebuild).not.toHaveBeenCalled()
  expect(vectors.saveCurrent).not.toHaveBeenCalled()
  expect(api.applyMeetingEmbedding).not.toHaveBeenCalled()
})

it("selects an explicit remote endpoint and keeps search read-only", async () => {
  const { vectors, store, embedder, api, load } = fixture()
  const capability = createMeetingSemanticCapabilities(store, 3, { load })
  await capability.search("example", { model: "served-example", baseUrl: "https://example.invalid/v1", dims: 2 })
  expect(api.createMeetingRemoteModel).toHaveBeenCalledWith({
    model: "served-example",
    baseUrl: "https://example.invalid/v1",
    dims: 2,
  })
  expect(api.openMeetingEmbedder).toHaveBeenCalledWith(
    {
      remote: {
        provider: "url:example.invalid",
        model: "served-example",
        dims: 2,
        baseUrl: "https://example.invalid/v1",
        shorten: false,
      },
    },
    expect.any(Object),
  )
  expect(embedder.close).toHaveBeenCalledOnce()
  expect(vectors.rebuild).not.toHaveBeenCalled()
  expect(api.applyMeetingEmbedding).not.toHaveBeenCalled()
})

it("settles the model without generating after cancelled rebuilding or a rebuild failure", async () => {
  const { vectors, store, embedder, api, load } = fixture()
  const controller = new AbortController()
  vectors.rebuild.mockImplementation(async () => {
    controller.abort()
    return { transcripts: 1, chunks: 2, hasMore: true, nextTranscriptId: 20 }
  })
  const capability = createMeetingSemanticCapabilities(store, 3, { load })
  await expect(capability.generate({ model: "example", yes: true, signal: controller.signal })).rejects.toMatchObject({
    code: "cancelled",
  })
  expect(api.applyMeetingEmbedding).not.toHaveBeenCalled()
  expect(embedder.close).toHaveBeenCalledOnce()
  vectors.rebuild.mockRejectedValue(new Error("invented rebuild failure"))
  await expect(capability.generate({ model: "example", yes: true })).rejects.toThrow("invented rebuild failure")
  expect(api.applyMeetingEmbedding).not.toHaveBeenCalled()
  expect(embedder.close).toHaveBeenCalledTimes(2)
})

it("rejects invalid accounts and cancellation before loading or opening the model", async () => {
  const { store, api, load } = fixture()
  expect(() => createMeetingSemanticCapabilities(store, 0, { load })).toThrow()
  const capability = createMeetingSemanticCapabilities(store, 3, { load })
  const controller = new AbortController()
  controller.abort()
  await expect(capability.search("example", { model: "example", signal: controller.signal })).rejects.toMatchObject({
    code: "cancelled",
  })
  await expect(capability.generate({ model: "example", signal: controller.signal })).rejects.toMatchObject({
    code: "cancelled",
  })
  expect(load).not.toHaveBeenCalled()
  expect(api.openMeetingEmbedder).not.toHaveBeenCalled()
})

it("splits every transcript page and embeds every missing passage page before a search that builds", async () => {
  const { vectors, store, descriptor, embedder, api, load } = fixture()
  vectors.rebuild
    .mockResolvedValueOnce({ transcripts: 1, chunks: 2, hasMore: true, nextTranscriptId: 20 })
    .mockResolvedValueOnce({ transcripts: 1, chunks: 1, hasMore: false, nextTranscriptId: 21 })
  api.applyMeetingEmbedding.mockResolvedValueOnce({
    accountId: 3,
    model: descriptor,
    saved: 1,
    skipped: 0,
    hasMore: false,
    nextHash: "b".repeat(64),
  })
  const capability = createMeetingSemanticCapabilities(store, 3, { load })
  await capability.search("example", { model: "example", buildMissing: true })
  expect(vectors.rebuild).toHaveBeenCalledTimes(2)
  expect(vectors.rebuild).toHaveBeenLastCalledWith(expect.objectContaining({ afterTranscriptId: 20 }))
  expect(api.applyMeetingEmbedding).toHaveBeenCalledTimes(1)
  expect(api.searchMeetingsCombined).toHaveBeenCalledOnce()
  expect(embedder.close).toHaveBeenCalledOnce()
})
