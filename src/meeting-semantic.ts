import { CliError } from "@wirecat/cli-base"
import type { MeetingEmbedder, ModelChoice } from "@wirecat/cli-core/services"
import type { MessageStore } from "@wirecat/cli-core/store"
import { checkCancelled } from "./errors.js"
import {
  type MeetingEmbeddingOptions,
  type MeetingModelOptions,
  type MeetingSemanticCapabilities,
  type MeetingSemanticOptions,
  validateMeetingEmbeddings,
  validateMeetingSemantic,
} from "./meeting-semantic-commands.js"

type ProducerSemanticApi = Pick<
  typeof import("@wirecat/cli-core/services"),
  | "meetingEmbeddingModel"
  | "createMeetingRemoteModel"
  | "openMeetingEmbedder"
  | "searchMeetingsCombined"
  | "proposeMeetingEmbedding"
  | "applyMeetingEmbedding"
>
const loadProducer = async (): Promise<ProducerSemanticApi> => import("@wirecat/cli-core/services")
/** The connection selects the account; explicit command options select the model. */
export const createMeetingSemanticCapabilities = (
  store: Pick<MessageStore, "meetings" | "meetingVectors"> & { knowledge?: MessageStore["knowledge"] },
  accountId: number,
  options: { env?: NodeJS.ProcessEnv; load?: () => Promise<ProducerSemanticApi> } = {},
): MeetingSemanticCapabilities => {
  if (!Number.isSafeInteger(accountId) || accountId < 1)
    throw new CliError("validation_error", "meeting vectors require a selected positive account ID")
  const load = options.load ?? loadProducer
  const choice = (api: ProducerSemanticApi, input: MeetingModelOptions): ModelChoice =>
    input.baseUrl === undefined
      ? input.model
      : { remote: api.createMeetingRemoteModel({ model: input.model, baseUrl: input.baseUrl, dims: input.dims }) }
  const budget = (input: MeetingSemanticOptions) => ({
    maxRows: input.maxRows,
    maxTextBytes: input.maxTextBytes,
    signal: input.signal,
  })
  // rebuild has no "new transcripts only" mode, so every pass splits every current transcript again; only
  // passages without a vector for this model reach the embedder.
  const buildMissing = async (api: ProducerSemanticApi, embedder: MeetingEmbedder, input: MeetingSemanticOptions) => {
    let afterTranscriptId: number | undefined
    for (;;) {
      checkCancelled(input.signal)
      const page = await store.meetingVectors.rebuild({ accountId, limit: 1000, afterTranscriptId, ...budget(input) })
      if (!page.hasMore || page.nextTranscriptId === undefined) break
      afterTranscriptId = page.nextTranscriptId
    }
    let afterHash: string | undefined
    for (;;) {
      checkCancelled(input.signal)
      const batch = await api.applyMeetingEmbedding(store.meetingVectors, accountId, embedder, {
        afterHash,
        ...budget(input),
      })
      if (!batch.hasMore || batch.nextHash === undefined) return
      afterHash = batch.nextHash
    }
  }
  return {
    search: async (query, input) => {
      validateMeetingSemantic(query, input)
      checkCancelled(input.signal)
      const api = await load()
      checkCancelled(input.signal)
      const selected = choice(api, input)
      const embedder = await api.openMeetingEmbedder(selected, { env: options.env, signal: input.signal })
      try {
        if (input.buildMissing) await buildMissing(api, embedder, input)
        return await api.searchMeetingsCombined(store, embedder, query, {
          ...input.selection,
          accountId,
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.after === undefined ? {} : { after: input.after }),
          ...(input.maxChunks === undefined ? {} : { maxChunks: input.maxChunks }),
          ...(input.maxRows === undefined ? {} : { maxRows: input.maxRows }),
          ...(input.maxTextBytes === undefined ? {} : { maxTextBytes: input.maxTextBytes }),
          ...(input.signal ? { signal: input.signal } : {}),
        })
      } finally {
        await embedder.close()
      }
    },
    generate: async (input: MeetingEmbeddingOptions) => {
      validateMeetingEmbeddings(input)
      checkCancelled(input.signal)
      const api = await load()
      checkCancelled(input.signal)
      const selected = choice(api, input)
      const descriptor = api.meetingEmbeddingModel(selected)
      if (input.yes !== true)
        return api.proposeMeetingEmbedding(store.meetingVectors, accountId, descriptor, { signal: input.signal })
      const embedder = await api.openMeetingEmbedder(selected, { env: options.env, signal: input.signal })
      try {
        checkCancelled(input.signal)
        const rebuild = await store.meetingVectors.rebuild({
          accountId,
          limit: input.limit,
          afterTranscriptId: input.afterTranscriptId,
          maxRows: input.maxRows,
          maxTextBytes: input.maxTextBytes,
          signal: input.signal,
        })
        checkCancelled(input.signal)
        const result = await api.applyMeetingEmbedding(store.meetingVectors, accountId, embedder, {
          maxChunks: input.limit,
          afterHash: input.afterHash,
          maxRows: input.maxRows,
          maxTextBytes: input.maxTextBytes,
          signal: input.signal,
        })
        return { ...result, applied: true, model: descriptor, rebuild }
      } finally {
        await embedder.close()
      }
    },
  }
}
