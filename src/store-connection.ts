import { CliError } from "@wirecat/cli-core"
import type { MessageStore, StoreOptions } from "@wirecat/cli-messaging/store"
import { ZoomError } from "./errors.js"
import type { StoreConnection, StoreConnectRequest } from "./program.js"

type SharedMeetingStore = Pick<MessageStore, "meetings" | "saveAccount" | "storedAccount" | "close">
export interface StoreConnectionOptions extends StoreOptions {
  openStore?: (options: StoreOptions) => Promise<SharedMeetingStore>
}

export const createStoreConnector =
  (options: StoreConnectionOptions = {}) =>
  async (request: StoreConnectRequest): Promise<StoreConnection> => {
    let store: SharedMeetingStore | undefined
    try {
      const open = options.openStore ?? (await import("@wirecat/cli-messaging/store")).openStore
      store = await open({ path: options.path, env: options.env, now: options.now })
      const key = { provider: "zoom", account: request.externalId }
      const accountId =
        request.intent === "ingestion"
          ? await store.saveAccount(key, { name: request.profile })
          : (await store.storedAccount(key)).id
      if (!Number.isSafeInteger(accountId) || accountId < 1)
        throw new ZoomError("configuration_error", "the selected meeting account is unavailable")
      const connected = store
      return { store: connected.meetings, accountId, close: () => connected.close() }
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
