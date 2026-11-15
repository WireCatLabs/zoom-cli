import { CliError } from "@wirecat/cli-base"
import type { MeetingSource } from "@wirecat/cli-core/meetings"
import { ZOOM_FINDS, ZoomApiSource } from "./api.js"
import { filesZone, type ZoomConfig } from "./config.js"
import type { ZoneAssumptions } from "./errors.js"
import { FilesSource, readDownloadedFiles } from "./files.js"
import type { ProgramDeps } from "./program.js"
import type { TokenManager } from "./tokens.js"
import { SET_ZOOM_APP } from "./zoom-app.js"

const unread = () => Promise.reject(new CliError("configuration_error", "this Zoom source cannot read meetings live"))

/** The API or folder source the config names, built on first use; reset() drops it between parses. */
export const configuredMeetingSource = ({
  deps,
  getConfig,
  tokens,
  fetch,
  zones,
}: {
  deps: Pick<ProgramDeps, "source" | "readFiles">
  getConfig: () => ZoomConfig
  tokens: () => TokenManager
  fetch: () => typeof globalThis.fetch
  zones: ZoneAssumptions
}): { source: MeetingSource; reset: () => void } => {
  let activeSource: Promise<MeetingSource> | undefined
  const getSource = (): Promise<MeetingSource> => {
    if (deps.source) return Promise.resolve(deps.source)
    activeSource ??= (async () => {
      const config = getConfig()
      if (config.source === "api") {
        const manager = tokens()
        if (!manager.options.clientId) throw new CliError("configuration_error", SET_ZOOM_APP)
        return new ZoomApiSource(manager, fetch(), {}, zones)
      }
      if (!config.filesFolder) throw new CliError("configuration_error", "set files.folder before pulling from files")
      return new FilesSource(await (deps.readFiles ?? readDownloadedFiles)(config.filesFolder), filesZone(config))
    })()
    return activeSource
  }
  const live = (): Pick<MeetingSource, "finds" | "find" | "get"> | undefined =>
    deps.source ?? (getConfig().source === "api" ? { finds: ZOOM_FINDS, find: unread, get: unread } : undefined)
  const sourceWith = async <K extends "find" | "get">(name: K) => {
    const active = await getSource()
    const port = active[name]
    if (!port) throw new CliError("configuration_error", "this Zoom source cannot read meetings live")
    return port.bind(active) as NonNullable<MeetingSource[K]>
  }
  const source: MeetingSource = {
    get provider() {
      return deps.source?.provider ?? "zoom"
    },
    get name() {
      return deps.source?.name ?? (getConfig().source === "api" ? "api" : "file")
    },
    get transcriptFormat() {
      return deps.source ? deps.source.transcriptFormat : "vtt"
    },
    async meetings(since) {
      return (await getSource()).meetings(since)
    },
    async participants(id) {
      return (await getSource()).participants(id)
    },
    async transcript(id) {
      return (await getSource()).transcript(id)
    },
    async chat(id) {
      return (await getSource()).chat(id)
    },
    async summary(id) {
      return (await getSource()).summary(id)
    },
    async files(id) {
      return (await getSource()).files(id)
    },
    // Only the API reads Zoom live; a folder of downloaded files has no meeting that is not in it.
    get finds() {
      return live()?.finds
    },
    get find(): MeetingSource["find"] {
      return live()?.find && (async (window, terms, cursor) => (await sourceWith("find"))(window, terms, cursor))
    },
    get get(): MeetingSource["get"] {
      return live()?.get && (async (id) => (await sourceWith("get"))(id))
    },
  }
  return {
    source,
    reset: () => {
      activeSource = undefined
    },
  }
}
