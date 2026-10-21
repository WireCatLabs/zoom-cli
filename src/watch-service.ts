import { CliError, isCliError, realSleep } from "@wirecat/cli-base"
import { importFiles, type MeetingStore, pull } from "@wirecat/cli-core/meetings"
import { ZoomApiSource } from "./api.js"
import { filesZone, type ZoomConfig } from "./config.js"
import { checkCancelled, type ZoneAssumptions } from "./errors.js"
import { importFile, readDownloadedFiles, validateDownloadedFiles } from "./files.js"
import type { ProgramDeps } from "./program.js"
import {
  type StoreConnection,
  type StoreConnectRequest,
  storeUnavailable,
  unavailableStore,
} from "./store-connection.js"
import type { TokenManager } from "./tokens.js"
import type { WatchCommandDeps, WatchPlan } from "./watch-commands.js"

export interface WatchServiceDeps {
  deps: Pick<ProgramDeps, "source" | "store" | "accountId" | "readFiles" | "now" | "sleep">
  getConfig: () => ZoomConfig
  tokens: () => TokenManager
  fetch: () => typeof fetch
  offline: () => boolean
  openStore: (intent: StoreConnectRequest["intent"]) => Promise<StoreConnection>
  guardedStore: (store: MeetingStore) => MeetingStore
  zones: ZoneAssumptions
}

/** Plans a watch and runs one ingestion cycle per call; reset() forgets the plan between parses. */
export const createWatchService = ({
  deps,
  getConfig,
  tokens,
  fetch,
  offline,
  openStore,
  guardedStore,
  zones,
}: WatchServiceDeps): Pick<WatchCommandDeps, "prepare" | "ingest"> & { reset: () => void } => {
  let watchConfig: ZoomConfig | undefined
  let watchSince: string | undefined
  return {
    reset: () => {
      watchConfig = undefined
      watchSince = undefined
    },
    prepare: (target, folder, flags): WatchPlan => {
      const config = { ...getConfig() }
      const source = target ?? config.source
      const plan = {
        source,
        since: flags.sinceTime,
        lookbackDays: flags.lookbackDays ?? 0,
        intervalMs: flags.pause,
        folder: folder ?? config.filesFolder ?? undefined,
      }
      if (source === "files") {
        if (flags.sinceTime !== undefined || flags.lookbackDays !== undefined)
          throw new CliError("validation_error", "--since-time and --lookback-days apply only to API watching")
        if (!plan.folder?.trim())
          throw new CliError("configuration_error", "set files.folder or provide a folder for file watching")
      } else {
        if (folder !== undefined) throw new CliError("validation_error", "API watching does not accept a folder")
        if (offline())
          throw new CliError("configuration_error", "API watching requires network access; remove --offline")
        if (!deps.source) {
          if (!config.clientId)
            throw new CliError("configuration_error", "run zm config set zoom.client_id <Public Client ID> first")
          if (tokens().options.clientId !== config.clientId)
            throw new CliError(
              "configuration_error",
              "the OAuth client changed before watch started; retry with matching configuration",
            )
        }
      }
      if (!deps.store && !config.accountProfile)
        throw new CliError("configuration_error", "select a local profile with zm config set account.profile <label>")
      watchConfig = config
      watchSince = plan.since
      return plan
    },
    ingest: async (plan, operation) => {
      checkCancelled(operation)
      const config = watchConfig
      if (!config) throw new CliError("configuration_error", "watch configuration is unavailable")
      let cycle: StoreConnection | undefined
      let failure: unknown
      let result: Awaited<ReturnType<typeof importFiles>> | undefined
      try {
        if (!deps.store) cycle = await openStore("ingestion")
        checkCancelled(operation)
        const accountId = cycle?.accountId ?? deps.accountId
        if (!Number.isSafeInteger(accountId) || !accountId || accountId < 1)
          throw new CliError("configuration_error", "the selected meeting account is unavailable")
        const store = guardedStore(cycle?.store ?? deps.store ?? unavailableStore)
        if (plan.source === "files") {
          const files = validateDownloadedFiles(
            await (deps.readFiles ?? readDownloadedFiles)(plan.folder ?? ""),
            filesZone(config),
          )
          checkCancelled(operation)
          result = await importFiles(
            files.map((file) => importFile(file, accountId, filesZone(config))),
            store,
            deps.now?.(),
          )
        } else {
          const original =
            deps.source ??
            new ZoomApiSource(
              tokens(),
              fetch(),
              {
                now: deps.now,
                sleep: (ms, abort) => (deps.sleep ?? realSleep)(ms, AbortSignal.any([operation, abort]), "retry"),
              },
              zones,
            )
          let sourceFailure: CliError | undefined
          const source = new Proxy(original, {
            get(target, key, receiver) {
              const method = Reflect.get(target, key, receiver)
              return typeof method === "function"
                ? async (...args: unknown[]) => {
                    if (sourceFailure) throw sourceFailure
                    checkCancelled(operation)
                    try {
                      const value = await method.apply(target, args)
                      checkCancelled(operation)
                      return value
                    } catch (error) {
                      if (isCliError(error) && error.code === "outcome_unknown") {
                        sourceFailure = error
                        throw error
                      }
                      checkCancelled(operation)
                      throw error
                    }
                  }
                : method
            },
          })
          let cursorAdvanced = false
          const trackingStore = new Proxy(store, {
            get(target, key, receiver) {
              if (key === "setCursor")
                return async (...args: Parameters<MeetingStore["setCursor"]>) => {
                  await target.setCursor(...args)
                  cursorAdvanced = true
                }
              return Reflect.get(target, key, receiver)
            },
          })
          result = await pull(source, trackingStore, {
            accountId,
            since: watchSince,
            lookbackMs: plan.lookbackDays * 86400000,
            now: deps.now?.(),
          })
          if (sourceFailure) throw sourceFailure
          checkCancelled(operation)
          if (cursorAdvanced) watchSince = undefined
        }
      } catch (error) {
        failure = error
      } finally {
        if (cycle) {
          try {
            await cycle.close()
          } catch {
            failure ??= new CliError("configuration_error", "could not close the shared meeting store")
          }
        }
      }
      if (failure) throw failure
      if (!result) return storeUnavailable()
      return result
    },
  }
}
