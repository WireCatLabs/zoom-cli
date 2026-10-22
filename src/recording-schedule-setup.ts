import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { CliError } from "@wirecat/cli-base"
import { readConfig, type ZoomConfig } from "./config.js"
import type { ZoneAssumptions } from "./errors.js"
import type { ProgramDeps } from "./program.js"
import {
  createRecordingScheduleService,
  type RecordingScheduleCapture,
  type RecordingScheduleService,
} from "./recording-schedule.js"
import { fileRecordingScheduleStore } from "./recording-schedule-store.js"
import { createSystemdRecordingArchiveScheduler } from "./recording-schedule-systemd.js"
import { ZoomRecordings } from "./recordings.js"
import type { RemoteOptions } from "./remote-http.js"
import { TokenManager } from "./tokens.js"

/** Saved jobs beside the config, Linux user timers, and per-job Zoom credentials checked against the selection. */
export const zoomRecordingSchedule = ({
  deps,
  getConfig,
  profile,
  withSignal,
  signal,
  remoteOptions,
  zones,
}: {
  deps: Pick<
    ProgramDeps,
    "configPath" | "env" | "tokens" | "now" | "fetch" | "recordingSchedule" | "recordingScheduleTarget"
  >
  getConfig: () => ZoomConfig
  profile: () => string
  withSignal: (fetcher: typeof fetch) => typeof fetch
  signal: () => AbortSignal | undefined
  remoteOptions: RemoteOptions
  zones: ZoneAssumptions
}): { service: () => RecordingScheduleService; capture: () => RecordingScheduleCapture } => {
  let recordingSchedule = deps.recordingSchedule
  return {
    service: () => {
      if (!recordingSchedule) {
        const env = deps.env ?? process.env
        const configDir = dirname(deps.configPath)
        recordingSchedule = createRecordingScheduleService({
          store: fileRecordingScheduleStore(join(configDir, "recording-schedules")),
          backend: createSystemdRecordingArchiveScheduler({
            unitDirectory: join(env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config"), "systemd", "user"),
          }),
          recordings: (job) => {
            const selected = readConfig(deps.configPath)
            if (
              dirname(deps.configPath) !== job.capture.configDir ||
              profile() !== job.capture.profile ||
              selected.clientId !== job.capture.clientId
            )
              throw new CliError(
                "configuration_error",
                "archive schedule requires its saved profile and Zoom client id; select those settings before running",
              )
            return new ZoomRecordings(
              new TokenManager({
                clientId: job.capture.clientId,
                account: `${job.capture.clientId}:${job.capture.profile}`,
                ...(selected.legacyProfile === job.capture.profile ? { legacyAccount: job.capture.clientId } : {}),
                keyring: deps.tokens.options.keyring,
                service: `zoom-cli:${job.capture.configDir}`,
                fetch: withSignal(deps.tokens.options.fetch),
                now: deps.now,
                signal: signal(),
                log: deps.tokens.options.log,
              }),
              withSignal(deps.fetch),
              remoteOptions,
              zones,
            )
          },
          now: deps.now,
        })
      }
      return recordingSchedule
    },
    capture: () => {
      const selected = getConfig()
      const named = profile()
      if (!selected.clientId)
        throw new CliError("configuration_error", "archive schedules require a configured Zoom client id")
      if (!deps.recordingScheduleTarget)
        throw new CliError("configuration_error", "archive scheduler requires an explicit runtime and CLI path")
      return {
        profile: named,
        clientId: selected.clientId,
        configDir: dirname(deps.configPath),
        runtime: deps.recordingScheduleTarget.runtime,
        cliPath: deps.recordingScheduleTarget.cliPath,
      }
    },
  }
}
