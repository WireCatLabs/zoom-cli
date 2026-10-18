import type { MeetingSeriesInventoryReader } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import type { PreparationStoreRequest, ZoomPreparationOptions } from "./meeting-preparation.js"
import type { MeetingModelOptions } from "./meeting-semantic-commands.js"
import type { StoreConnection } from "./store-connection.js"

export interface MeetingMcpOptions {
  /** Resolve the selected profile with read intent; each call owns a fresh connection. */
  connectStore: (request?: PreparationStoreRequest) => Promise<StoreConnection>
  commandRegistry?: Command
  version?: string
  now?: () => number
  signal?: AbortSignal
  /** Maximum UTF-8 bytes in a serialized tool result, including both content forms; zero is unlimited. */
  maxResultBytes?: number
  /** Opt-in selected-profile meetings only; store-global notes are never exposed here. */
  includeUnifiedSearch?: boolean
  includeMeetingContext?: boolean
  /** Explicit grant to compare selected meeting evidence with the global project vocabulary. */
  includeMeetingProjectCandidates?: boolean
  /** Explicit provider/account-bound inventory reader; initialization must perform no provider reads. */
  inventory?: MeetingSeriesInventoryReader
  preparation?: ZoomPreparationOptions
  /** Server-selected query model; callers cannot select models or generate vectors. */
  semanticModel?: MeetingModelOptions
}
