import { CliError, isCliError } from "@wirecat/cli-base"
import { type MeetingBatchReader, validateMeetingContextChange } from "@wirecat/cli-core/meetings"
import type { MessageStore, StoreOptions } from "@wirecat/cli-core/store"
import { profileAccountKey } from "./config.js"
import { createLocalTranscriptionCapabilities } from "./local-transcription.js"
import { createMeetingContextCapabilities } from "./meeting-context.js"
import { integrationReference } from "./meeting-integration.js"
import { validateMeetingHitSearch } from "./meeting-search-commands.js"
import { createMeetingSemanticCapabilities } from "./meeting-semantic.js"
import type { StoreConnection, StoreConnectRequest } from "./program.js"
import { validateUnifiedSearch } from "./unified-search.js"

export interface StoreConnectionOptions extends StoreOptions {
  openStore?: (options: StoreOptions) => Promise<MessageStore>
}

export const createStoreConnector =
  (options: StoreConnectionOptions = {}) =>
  async (request: StoreConnectRequest): Promise<StoreConnection> => {
    const { profile, externalId, intent } = request ?? {}
    if (
      typeof profile !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile) ||
      externalId !== profileAccountKey(profile) ||
      (intent !== "read" && intent !== "ingestion")
    )
      throw new CliError("validation_error", "expected a selected Zoom profile and read or ingestion intent")
    let store: MessageStore | undefined
    try {
      const open = options.openStore ?? (await import("@wirecat/cli-core/store")).openStore
      store = await open({ path: options.path, env: options.env, now: options.now })
      const connected = store
      const meetings = connected.meetings
      const key = { provider: "zoom", account: externalId }
      const accountId =
        intent === "ingestion"
          ? await connected.saveAccount(key, { name: profile })
          : (await connected.storedAccount(key)).id
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
            const service = createMeetingPreparationService(key, accountId, { meetings, upcoming })
            return service.prepare.bind(service)
          },
        },
        store: meetings,
        accountId,
        close: () => connected.close(),
        appendTranscriptsWithReceipt: (input) => meetings.appendTranscriptsWithReceipt(ownAccount(input, "append")),
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
                storedAccount: connected.storedAccount.bind(connected),
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
        meetingSemantic: createMeetingSemanticCapabilities(connected.meetingVectors, accountId, { env: options.env }),
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
