import { CliError } from "@wirecat/cli-base"
import type { MeetingSource } from "@wirecat/cli-core/meetings"
import { ZoomApiSource } from "./api.js"
import type { ZoomConfig } from "./config.js"
import { FilesSource, readDownloadedFiles } from "./files.js"
import type { ProgramDeps } from "./program.js"
import type { TokenManager } from "./tokens.js"

/** The API or folder source the config names, built on first use; reset() drops it between parses. */
export const configuredMeetingSource = ({
  deps,
  getConfig,
  tokens,
  fetch,
}: {
  deps: Pick<ProgramDeps, "source" | "readFiles">
  getConfig: () => ZoomConfig
  tokens: () => TokenManager
  fetch: () => typeof globalThis.fetch
}): { source: MeetingSource; reset: () => void } => {
  let activeSource: Promise<MeetingSource> | undefined
  const getSource = (): Promise<MeetingSource> => {
    if (deps.source) return Promise.resolve(deps.source)
    activeSource ??= (async () => {
      const config = getConfig()
      if (config.source === "api") return new ZoomApiSource(tokens(), fetch())
      if (!config.filesFolder) throw new CliError("configuration_error", "set files.folder before pulling from files")
      return new FilesSource(await (deps.readFiles ?? readDownloadedFiles)(config.filesFolder), config.filesTimezone)
    })()
    return activeSource
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
  }
  return {
    source,
    reset: () => {
      activeSource = undefined
    },
  }
}
