import { CliError } from "@wirecat/cli-core"
import {
  dispatchMeetingMutation,
  type MeetingContextStore,
  type MeetingSearchIndexStore,
  type MeetingSearchStore,
  type MeetingTranscriptReceiptStore,
  type MeetingTranscriptStore,
  validateMeetingContextChange,
} from "@wirecat/cli-meetings"
import type { MessageStore, StoreOptions } from "@wirecat/cli-messaging/store"
import { profileAccountKey } from "./config.js"
import { ZoomError } from "./errors.js"
import { createLocalTranscriptionCapabilities } from "./local-transcription.js"
import { createMeetingContextCapabilities } from "./meeting-context.js"
import { integrationReference } from "./meeting-integration.js"
import { validateMeetingHitSearch } from "./meeting-search-commands.js"
import { createMeetingSemanticCapabilities } from "./meeting-semantic.js"
import type { StoreConnection, StoreConnectRequest } from "./program.js"
import { validateUnifiedSearch } from "./unified-search.js"

type OptionalMeetingPorts = MeetingTranscriptReceiptStore &
  MeetingSearchStore &
  MeetingSearchIndexStore &
  MeetingContextStore
type SharedMeetingStore = Pick<MessageStore, "saveAccount" | "storedAccount" | "close"> & {
  meetings: Omit<MessageStore["meetings"], keyof OptionalMeetingPorts> &
    Partial<MeetingTranscriptReceiptStore & MeetingSearchStore & MeetingSearchIndexStore & MeetingContextStore>
} & Partial<
    Pick<
      MessageStore,
      | "meetingVectors"
      | "personByUid"
      | "personSeenInAccounts"
      | "involvements"
      | "notes"
      | "knowledge"
      | "memories"
      | "facts"
    >
  >
const contextServiceMeetings = (meetings: SharedMeetingStore["meetings"]): meetings is MessageStore["meetings"] =>
  typeof meetings.appendTranscriptsWithReceipt === "function" &&
  typeof meetings.searchHits === "function" &&
  typeof meetings.indexSearch === "function" &&
  typeof meetings.linkMeetingEvent === "function" &&
  typeof meetings.linkParticipantPerson === "function" &&
  typeof meetings.participantPerson === "function"
export interface StoreConnectionOptions extends StoreOptions {
  openStore?: (options: StoreOptions) => Promise<SharedMeetingStore>
}

export const createStoreConnector =
  (options: StoreConnectionOptions = {}) =>
  async (request: StoreConnectRequest): Promise<StoreConnection> => {
    const input = {
      profile: request?.profile,
      externalId: request?.externalId,
      intent: request?.intent,
      capability: request?.capability,
    }
    if (
      typeof input.profile !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.profile) ||
      input.externalId !== profileAccountKey(input.profile) ||
      (input.intent !== "read" && input.intent !== "ingestion") ||
      (input.capability !== undefined &&
        !["transcript-append", "meeting-integration", "meeting-search", "meeting-search-index"].includes(
          input.capability,
        ))
    )
      throw new ZoomError("validation_error", "expected a selected Zoom profile and read or ingestion intent")
    let store: SharedMeetingStore | undefined
    try {
      const open = options.openStore ?? (await import("@wirecat/cli-messaging/store")).openStore
      store = await open({ path: options.path, env: options.env, now: options.now })
      const append = (store.meetings as Partial<MeetingTranscriptStore>).appendTranscripts
      const appendReceipt = (store.meetings as Partial<MeetingTranscriptReceiptStore>).appendTranscriptsWithReceipt
      if (
        input.capability === "transcript-append" &&
        typeof append !== "function" &&
        typeof appendReceipt !== "function"
      )
        throw new ZoomError("configuration_error", "the installed meeting store does not support transcript append")
      const key = { provider: "zoom", account: input.externalId }
      const accountId =
        input.intent === "ingestion"
          ? await store.saveAccount(key, { name: input.profile })
          : (await store.storedAccount(key)).id
      if (!Number.isSafeInteger(accountId) || accountId < 1)
        throw new ZoomError("configuration_error", "the selected meeting account is unavailable")
      const connected = store
      const searchHits = connected.meetings.searchHits
      const indexSearch = connected.meetings.indexSearch
      const notes = connected.notes
      const knowledge = connected.knowledge
      const memories = connected.memories
      const facts = connected.facts
      const contextMeetings = contextServiceMeetings(connected.meetings) ? connected.meetings : undefined
      if (
        input.capability === "meeting-integration" &&
        (!notes || !knowledge || !memories || !facts || !contextMeetings)
      )
        throw new ZoomError("configuration_error", "the installed store does not support meeting knowledge integration")
      if (input.capability === "meeting-search" && typeof connected.meetings.searchHits !== "function")
        throw new ZoomError("configuration_error", "the installed meeting store does not support bounded hit search")
      if (input.capability === "meeting-search-index" && typeof connected.meetings.indexSearch !== "function")
        throw new ZoomError(
          "configuration_error",
          "the installed meeting store does not support bounded search indexing",
        )
      return {
        store: connected.meetings,
        accountId,
        close: () => connected.close(),
        ...(typeof append === "function"
          ? {
              appendTranscripts: (input: Parameters<MeetingTranscriptStore["appendTranscripts"]>[0]) => {
                if (input.accountId !== accountId)
                  throw new ZoomError("validation_error", "append account is selected by the connection")
                return append.call(connected.meetings, input)
              },
            }
          : {}),
        ...(typeof appendReceipt === "function"
          ? {
              appendTranscriptsWithReceipt: (
                input: Parameters<MeetingTranscriptReceiptStore["appendTranscriptsWithReceipt"]>[0],
              ) => {
                if (input.accountId !== accountId)
                  throw new ZoomError("validation_error", "append account is selected by the connection")
                return appendReceipt.call(connected.meetings, input)
              },
            }
          : {}),
        ...(typeof appendReceipt === "function" && typeof connected.meetings.meetingMetadata === "function"
          ? {
              meetingTranscription: createLocalTranscriptionCapabilities(
                {
                  accountId,
                  resolveMeeting: async (value, signal) => {
                    const reference = /^[1-9]\d*$/.test(value) ? `meeting:${accountId}/${value}` : value
                    const target = integrationReference(reference)
                    if (target.parsed.accountId !== accountId) return null
                    const meeting = await connected.meetings.meetingMetadata({
                      accountId,
                      meetingId: target.parsed.meetingId,
                      signal,
                    })
                    if (
                      meeting.accountId !== accountId ||
                      meeting.id !== target.parsed.meetingId ||
                      meeting.deletedAt !== null
                    )
                      return null
                    return { accountId, meetingId: meeting.id, externalId: meeting.externalId }
                  },
                  appendTranscriptsWithReceipt: (input) => {
                    if (input.accountId !== accountId)
                      throw new ZoomError("validation_error", "transcription account is selected by the connection")
                    return appendReceipt.call(connected.meetings, input)
                  },
                },
                { env: options.env, now: options.now },
              ),
            }
          : {}),
        ...(typeof indexSearch === "function"
          ? {
              meetingSearchIndex: async (input) => {
                validateMeetingHitSearch("index", input)
                const limit = input.limit ?? 100
                const maxReadBytes = input.maxReadBytes ?? 4194304
                const signal = input.signal
                const outcome = await dispatchMeetingMutation(
                  { apply: input.apply, dryRun: input.dryRun, signal },
                  () => indexSearch.call(connected.meetings, { accountId, limit, maxReadBytes, signal }),
                )
                return {
                  applied: outcome.applied,
                  accountId,
                  request: { limit, maxReadBytes },
                  ...(outcome.value ?? {}),
                }
              },
            }
          : {}),
        ...(typeof searchHits === "function"
          ? {
              meetingSearch: async (query, options) => {
                const { meetingId, since, until, limit, after, maxReadBytes, signal } = options
                return searchHits.call(connected.meetings, query, {
                  accountId,
                  meetingId,
                  since,
                  until,
                  limit,
                  after,
                  maxReadBytes,
                  signal,
                })
              },
            }
          : {}),
        ...(notes && knowledge && memories && facts && contextMeetings
          ? {
              meetingIntegration: {
                change: async (reference, input, options = {}) => {
                  const source = integrationReference(reference)
                  if (source.parsed.accountId !== accountId)
                    throw new ZoomError("not_found", "meeting is unavailable for the selected account")
                  const change = validateMeetingContextChange(input)
                  if (change.action !== "event.link" && change.action !== "person.link")
                    throw new ZoomError(
                      "validation_error",
                      "meeting linking supports only explicit event or person changes",
                    )
                  const mutation = { apply: options.apply, dryRun: options.dryRun, signal: options.signal }
                  const api = await import("@wirecat/cli-messaging/services")
                  if (typeof api.createMeetingContextService !== "function")
                    throw new ZoomError(
                      "configuration_error",
                      "the installed producer does not support meeting links; install a compatible published version",
                    )
                  await api.resolveMeetingReference(connected.meetings, accountId, source.reference, {
                    signal: mutation.signal,
                  })
                  const service = await api.createMeetingContextService(
                    {
                      storedAccount: connected.storedAccount.bind(connected),
                      meetings: contextMeetings,
                      notes,
                      knowledge,
                      memories,
                      facts,
                    },
                    key,
                  )
                  if (
                    service.accountId !== accountId ||
                    service.scope.provider !== key.provider ||
                    service.scope.account !== key.account
                  )
                    throw new ZoomError("invalid_response", "meeting context service returned an inconsistent account")
                  return service.change(source.parsed.meetingId, change, mutation)
                },
              },
            }
          : {}),
        unifiedSearch: async (input) => {
          const request = validateUnifiedSearch(input)
          const { searchAllIncludingMeetings } = await import("@wirecat/cli-messaging/services")
          return searchAllIncludingMeetings(connected as MessageStore, key, {
            ...request,
            meetingAccount: key,
            env: options.env,
          })
        },
        meetingContext: createMeetingContextCapabilities(connected, connected.meetings, accountId),
        ...(connected.meetingVectors
          ? {
              meetingSemantic: createMeetingSemanticCapabilities(connected.meetingVectors, accountId, {
                env: options.env,
              }),
            }
          : {}),
      }
    } catch (error) {
      if (store) {
        try {
          await store.close()
        } catch {
          /* Preserve the setup failure. */
        }
      }
      if (error instanceof ZoomError) throw error
      if (error instanceof CliError && error.code === "not_found")
        throw new ZoomError(
          "configuration_error",
          "no stored meetings for the selected profile; import transcripts or pull first",
        )
      throw new ZoomError(
        "configuration_error",
        "could not connect to the shared meeting store; check MESSAGING_STORE and the installed store version",
      )
    }
  }
