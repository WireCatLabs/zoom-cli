import { CliError } from "@wirecat/cli-core"
import type { MeetingTranscriptStore } from "@wirecat/cli-meetings"
import type { MessageStore, StoreOptions } from "@wirecat/cli-messaging/store"
import { profileAccountKey } from "./config.js"
import { ZoomError } from "./errors.js"
import type { StoreConnection, StoreConnectRequest } from "./program.js"
import { validateUnifiedSearch } from "./unified-search.js"

type SharedMeetingStore = Pick<MessageStore, "meetings" | "saveAccount" | "storedAccount" | "close">
export interface StoreConnectionOptions extends StoreOptions {
  openStore?: (options: StoreOptions) => Promise<SharedMeetingStore>
}

export const createStoreConnector =
  (options: StoreConnectionOptions = {}) =>
  async (request: StoreConnectRequest): Promise<StoreConnection> => {
    if (
      typeof request?.profile !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(request.profile) ||
      request.externalId !== profileAccountKey(request.profile) ||
      (request.intent !== "read" && request.intent !== "ingestion") ||
      (request.capability !== undefined && request.capability !== "transcript-append")
    )
      throw new ZoomError("validation_error", "expected a selected Zoom profile and read or ingestion intent")
    let store: SharedMeetingStore | undefined
    try {
      const open = options.openStore ?? (await import("@wirecat/cli-messaging/store")).openStore
      store = await open({ path: options.path, env: options.env, now: options.now })
      const append = (store.meetings as Partial<MeetingTranscriptStore>).appendTranscripts
      if (request.capability === "transcript-append" && typeof append !== "function")
        throw new ZoomError("configuration_error", "the installed meeting store does not support transcript append")
      const key = { provider: "zoom", account: request.externalId }
      const accountId =
        request.intent === "ingestion"
          ? await store.saveAccount(key, { name: request.profile })
          : (await store.storedAccount(key)).id
      if (!Number.isSafeInteger(accountId) || accountId < 1)
        throw new ZoomError("configuration_error", "the selected meeting account is unavailable")
      const connected = store
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
        unifiedSearch: async (input) => {
          const request = validateUnifiedSearch(input)
          const { searchAllIncludingMeetings } = await import("@wirecat/cli-messaging/services")
          return searchAllIncludingMeetings(connected as MessageStore, key, {
            ...request,
            meetingAccount: key,
            env: options.env,
          })
        },
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
