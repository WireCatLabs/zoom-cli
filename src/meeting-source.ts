import { CliError } from "@wirecat/cli-base"
import type { MeetingSource } from "@wirecat/cli-core/meetings"
import { ZOOM_FINDS, ZoomApiSource } from "./api.js"
import { filesZone, type ZoomConfig } from "./config.js"
import type { ZoneAssumptions } from "./errors.js"
import { FilesSource, readDownloadedFiles } from "./files.js"
import type { ProgramDeps } from "./program.js"
import type { TokenManager } from "./tokens.js"
import { SET_ZOOM_APP } from "./zoom-app.js"

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
  // Declared before the source is built, so a list knows what Zoom reads without a login.
  const live = (name: "find" | "get") => (deps.source ? deps.source[name] !== undefined : getConfig().source === "api")
  // A getter answered that the source has the port, so the built one does.
  const ported = async () => (await getSource()) as Required<MeetingSource>
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
      return deps.source ? deps.source.finds : getConfig().source === "api" ? ZOOM_FINDS : undefined
    },
    get find(): MeetingSource["find"] {
      return live("find") ? async (window, terms, cursor) => (await ported()).find(window, terms, cursor) : undefined
    },
    get get(): MeetingSource["get"] {
      return live("get") ? async (id) => (await ported()).get(id) : undefined
    },
  }
  return {
    source,
    reset: () => {
      activeSource = undefined
    },
  }
}
