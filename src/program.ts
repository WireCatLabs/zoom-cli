import { CliError, type SleepLike } from "@wirecat/cli-base"
import { type BaseEnvironment, createProgram as sharedProgram } from "@wirecat/cli-core/cli"
import type { MeetingSource, MeetingStore } from "@wirecat/cli-core/meetings"
import type { Command } from "commander"
import type {
  ArchiveService,
  ArchiveTranscriptService,
  RecordingsService,
  RemoteMeetingsService,
} from "./archive-commands.js"
import type { readDownloadedFiles } from "./files.js"
import type { ZoomMcpOptions } from "./mcp.js"
import type { RecordingScheduleService } from "./recording-schedule.js"
import { runCommand, zoomDefinition } from "./run.js"
import type { StoreConnection, StoreConnectRequest } from "./store-connection.js"
import type { TokenManager } from "./tokens.js"
import type { ZoomSearchService } from "./zoom-search-commands.js"

export interface ProgramDeps {
  agent?: BaseEnvironment["agent"]
  configPath: string
  tokens: TokenManager
  fetch: typeof fetch
  store?: MeetingStore
  accountId?: number
  connectStore?: (request: StoreConnectRequest) => Promise<StoreConnection>
  source?: MeetingSource
  recordings?: RecordingsService
  recordingSchedule?: RecordingScheduleService
  recordingScheduleTarget?: { runtime: string; cliPath: string }
  remoteMeetings?: RemoteMeetingsService
  zoomSearch?: ZoomSearchService
  archive?: ArchiveService
  archiveTranscripts?: ArchiveTranscriptService
  readFiles?: typeof readDownloadedFiles
  writeFile?: (path: string, content: string, options?: { signal?: AbortSignal }) => Promise<void>
  openBrowser: (url: string, browser?: string) => Promise<void>
  readPaste?: (signal: AbortSignal) => Promise<string>
  /** A y/N question, default no; only at a terminal. */
  confirm?: (question: string) => Promise<boolean>
  /** The WireCat first-run questions, before a command; only the real binary passes it. */
  atStart?: (command: Command) => Promise<void>
  readBatchInput?: (path: string, signal?: AbortSignal) => Promise<string>
  data: (text: string) => void
  diagnostic: (text: string) => void
  now?: () => number
  outputIsTTY?: boolean
  env?: NodeJS.ProcessEnv
  checkSession?: (options?: { signal?: AbortSignal }) => Promise<unknown>
  signal?: AbortSignal
  sleep?: SleepLike
  serveMcp?: (options: ZoomMcpOptions) => Promise<void>
  streamData?: (text: string, signal: AbortSignal) => Promise<void>
}
export const run = runCommand

export const createProgram = (deps: ProgramDeps): Command => {
  const program = sharedProgram(zoomDefinition(deps))
  program.parse = () => {
    throw new CliError("validation_error", "use parseAsync so command guards and cleanup run before returning")
  }
  let parsing = false
  program.parseAsync = async (argv = process.argv, options) => {
    if (parsing) throw new CliError("validation_error", "concurrent command parsing is unavailable")
    parsing = true
    let failure: unknown
    try {
      const args = options?.from === "user" ? argv : argv.slice(2)
      await runCommand([...args], deps, (error) => {
        failure = error
      })
      if (failure) throw failure
      return program
    } finally {
      parsing = false
    }
  }
  return program
}
