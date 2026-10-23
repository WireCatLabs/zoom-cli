import { CliError, isCliError } from "@wirecat/cli-base"
import {
  type MeetingBatchReader,
  type MeetingProjectDiscoveryReader,
  type MeetingStore,
  type MeetingTranscriptReceiptStore,
  validateMeetingContextChange,
} from "@wirecat/cli-core/meetings"
import type { MeetingSearchesService, StoredMeetingProjectCandidateReader } from "@wirecat/cli-core/services"
import type { MessageStore, StoreOptions } from "@wirecat/cli-core/store"
import { profileAccountKey } from "./config.js"
import { createLocalTranscriptionCapabilities, type LocalTranscriptionCapabilities } from "./local-transcription.js"
import type { ContextCapture } from "./meeting-communications-binding.js"
import { createMeetingContextCapabilities, type MeetingContextCapabilities } from "./meeting-context.js"
import { integrationReference, type MeetingIntegrationCapabilities } from "./meeting-integration.js"
import type { MeetingPreparationBinding } from "./meeting-preparation.js"
import type { MeetingLinksRead, MeetingReviewRead } from "./meeting-review-commands.js"
import { type MeetingHitSearch, validateMeetingHitSearch } from "./meeting-search-commands.js"
import { createMeetingSemanticCapabilities } from "./meeting-semantic.js"
import type { MeetingSemanticCapabilities } from "./meeting-semantic-commands.js"
import type { MeetingStatsRead } from "./meeting-stats-commands.js"
import { profilePattern } from "./profile.js"
import { type UnifiedSearch, validateUnifiedSearch } from "./unified-search.js"

export interface StoreConnection {
  store: MeetingStore
  accountId: number
  close: () => Promise<void>
  appendTranscriptsWithReceipt: MeetingTranscriptReceiptStore["appendTranscriptsWithReceipt"]
  meetingIntegration: MeetingIntegrationCapabilities
  meetingSearch: MeetingHitSearch
  meetingBatch?: MeetingBatchReader
  meetingPreparation: MeetingPreparationBinding
  meetingProjectCandidates?: StoredMeetingProjectCandidateReader
  meetingProjectEvidence: MeetingProjectDiscoveryReader
  meetingTranscription: LocalTranscriptionCapabilities
  unifiedSearch: UnifiedSearch
  meetingContext: MeetingContextCapabilities
  meetingSemantic: MeetingSemanticCapabilities
  meetingStats?: MeetingStatsRead
  meetingReview?: MeetingReviewRead
  meetingLinks?: MeetingLinksRead
  meetingSearches?: MeetingSearchesService
}
export interface StoreConnectRequest {
  profile: string
  externalId: string
  intent: "read" | "ingestion" | "preparation"
  context?: ContextCapture
}
export const storeUnavailable = async (): Promise<never> => {
  throw new CliError("configuration_error", "the shared SQLite meeting store is not available yet")
}
export const unavailableStore: MeetingStore = {
  saveMeeting: storeUnavailable,
  account: storeUnavailable,
  meetings: storeUnavailable,
  meeting: storeUnavailable,
  participants: storeUnavailable,
  search: storeUnavailable,
  events: storeUnavailable,
  eventCandidates: storeUnavailable,
  createEvent: storeUnavailable,
  createEventSeries: storeUnavailable,
  setEventSeries: storeUnavailable,
  linkMeeting: storeUnavailable,
  cursor: storeUnavailable,
  setCursor: storeUnavailable,
}
export const connectSelectedProfile = (
  connect: (request: StoreConnectRequest) => Promise<StoreConnection>,
  profile: string | null | undefined,
  intent: StoreConnectRequest["intent"],
  context?: ContextCapture,
): Promise<StoreConnection> => {
  if (!profile) throw new CliError("validation_error", "name a profile: `zm <profile> …`")
  return connect({ profile, externalId: profileAccountKey(profile), intent, ...(context ? { context } : {}) })
}

export interface StoreConnectionOptions extends StoreOptions {
  openStore?: (options: StoreOptions) => Promise<MessageStore>
}

export const createStoreConnector =
  (options: StoreConnectionOptions = {}) =>
  async (request: StoreConnectRequest): Promise<StoreConnection> => {
    const { profile, externalId, intent, context } = request ?? {}
    if (
      typeof profile !== "string" ||
      !profilePattern.test(profile) ||
      externalId !== profileAccountKey(profile) ||
      (intent !== "read" && intent !== "ingestion" && intent !== "preparation") ||
      (context !== undefined &&
        (intent !== "preparation" || typeof context.resolve !== "function" || typeof context.assert !== "function"))
    )
      throw new CliError("validation_error", "expected a selected Zoom profile and read or ingestion intent")
    let store: MessageStore | undefined
    try {
      const open = options.openStore ?? (await import("@wirecat/cli-core/store")).openStore
      store = await open({
        path: options.path,
        env: options.env,
        now: options.now,
        ...(intent === "preparation" ? { readOnly: true } : {}),
      })
      const connected = store
      const meetings = connected.meetings
      const key = { provider: "zoom", account: externalId }
      const accountId =
        intent === "ingestion"
          ? await connected.accounts.saveAccount(key, { name: profile })
          : (await connected.accounts.storedAccount(key)).id
      if (!Number.isSafeInteger(accountId) || accountId < 1)
        throw new CliError("configuration_error", "the selected meeting account is unavailable")
      const ownAccount = <T extends { accountId: number }>(input: T, what: string): T => {
        if (input.accountId !== accountId)
          throw new CliError("validation_error", `${what} account is selected by the connection`)
        return input
      }
      let cachedBatchReader: MeetingBatchReader | undefined
      const batchReader = async () => {
        if (!cachedBatchReader) {
          const { createMeetingBatchReader } = await import("@wirecat/cli-core/services")
          cachedBatchReader = createMeetingBatchReader(connected, accountId)
        }
        return cachedBatchReader
      }
      return {
        meetingPreparation: {
          scope: key,
          create: async (upcoming) => {
            const { createMeetingPreparationService } = await import("@wirecat/cli-core/services")
            const reader = connected.contextEvidence
            if (context && !reader)
              throw new CliError("configuration_error", "the installed store does not support bounded communications")
            const communications =
              context && reader
                ? {
                    reader,
                    selections: await context.resolve({
                      storedAccount: connected.accounts.storedAccount.bind(connected.accounts),
                      accountById: connected.meetings.account.bind(connected.meetings),
                    }),
                  }
                : undefined
            const service = createMeetingPreparationService(key, accountId, {
              ...(communications ? { communications } : {}),
              meetings,
              upcoming,
              projectDiscovery: { vocabulary: connected.knowledge, search: meetings },
            })
            return service.prepare.bind(service)
          },
        },
        store: meetings,
        accountId,
        close: () => connected.close(),
        appendTranscriptsWithReceipt: (input) => meetings.appendTranscriptsWithReceipt(ownAccount(input, "append")),
        meetingProjectCandidates: async (reference, request) => {
          const { createStoredMeetingProjectCandidateReader } = await import("@wirecat/cli-core/services")
          const read = createStoredMeetingProjectCandidateReader(key, accountId, {
            meetings,
            vocabulary: connected.knowledge,
          })
          return read(reference, request)
        },
        meetingProjectEvidence: async (project, request) => {
          const { readMeetingProjectDiscovery } = await import("@wirecat/cli-core/services")
          return readMeetingProjectDiscovery(
            {
              vocabulary: connected.knowledge,
              search: { searchHits: (query, hits) => meetings.searchHits(query, hits) },
            },
            project,
            { ...request, accountId },
          )
        },
        meetingTranscription: createLocalTranscriptionCapabilities(
          {
            accountId,
            resolveMeeting: async (value, signal) => {
              const reference = /^[1-9]\d*$/.test(value) ? `meeting:${accountId}/${value}` : value
              const target = integrationReference(reference)
              if (target.parsed.accountId !== accountId) return null
              const meeting = await meetings.meetingMetadata({ accountId, meetingId: target.parsed.meetingId, signal })
              if (
                meeting.accountId !== accountId ||
                meeting.id !== target.parsed.meetingId ||
                meeting.deletedAt !== null
              )
                return null
              return { accountId, meetingId: meeting.id, externalId: meeting.externalId }
            },
            appendTranscriptsWithReceipt: (input) =>
              meetings.appendTranscriptsWithReceipt(ownAccount(input, "transcription")),
          },
          { env: options.env, now: options.now },
        ),
        meetingBatch: {
          index: async (input) => (await batchReader()).index(input),
          search: async (query, input) => (await batchReader()).search(query, input),
          passage: async (reference, input) => (await batchReader()).passage(reference, input),
        },
        meetingSearch: async (query, request) => {
          validateMeetingHitSearch(query, request)
          const { searchMeetingHits } = await import("@wirecat/cli-core/services")
          return searchMeetingHits({ meetings, knowledge: connected.knowledge }, query, { ...request, accountId })
        },
        meetingIntegration: {
          change: async (reference, input, mutation = {}) => {
            const source = integrationReference(reference)
            if (source.parsed.accountId !== accountId)
              throw new CliError("not_found", "meeting is unavailable for the selected account")
            const change = validateMeetingContextChange(input)
            if (change.action !== "event.link" && change.action !== "person.link")
              throw new CliError("validation_error", "meeting linking supports only explicit event or person changes")
            const api = await import("@wirecat/cli-core/services")
            await api.resolveMeetingReference(meetings, accountId, source.reference, { signal: mutation.signal })
            const service = await api.createMeetingContextService(
              {
                accounts: connected.accounts,
                meetings,
                notes: connected.notes,
                knowledge: connected.knowledge,
                memories: connected.memories,
                facts: connected.facts,
              },
              key,
            )
            if (
              service.accountId !== accountId ||
              service.scope.provider !== key.provider ||
              service.scope.account !== key.account
            )
              throw new CliError("invalid_response", "meeting context service returned an inconsistent account")
            return service.change(source.parsed.meetingId, change, {
              apply: mutation.apply,
              dryRun: mutation.dryRun,
              signal: mutation.signal,
            })
          },
        },
        unifiedSearch: async (input) => {
          const request = validateUnifiedSearch(input)
          const { searchAllIncludingMeetings } = await import("@wirecat/cli-core/services")
          return searchAllIncludingMeetings(connected, key, { ...request, meetingAccount: key, env: options.env })
        },
        meetingContext: createMeetingContextCapabilities(connected, meetings, accountId),
        meetingSemantic: createMeetingSemanticCapabilities(connected, accountId, { env: options.env }),
        meetingSearches: await (async () => {
          const { meetingSearchesService } = await import("@wirecat/cli-core/services")
          return meetingSearchesService(async () => connected.searches)
        })(),
        meetingStats: async (request) => {
          const { readMeetingStats } = await import("@wirecat/cli-core/services")
          return readMeetingStats(connected, { ...request, accountId })
        },
        meetingReview: async (request) => {
          const { readMeetingReview } = await import("@wirecat/cli-core/services")
          return readMeetingReview(connected, { ...request, accountId })
        },
        meetingLinks: async (request) => {
          const { readMeetingLinks } = await import("@wirecat/cli-core/services")
          return readMeetingLinks(connected, { ...request, accountId })
        },
      }
    } catch (error) {
      await store?.close().catch(() => undefined)
      if (isCliError(error) && error.code === "not_found")
        throw new CliError(
          "configuration_error",
          "no stored meetings for the selected profile; import transcripts or pull first",
        )
      if (isCliError(error)) throw error
      throw new CliError(
        "configuration_error",
        "could not connect to the shared meeting store; check MESSAGING_STORE and the installed store version",
      )
    }
  }
