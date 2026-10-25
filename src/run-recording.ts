import { isCliError, type RenderFormat } from "@wirecat/cli-base"
import {
  type BaseEnvironment,
  KEEP_RUNS_FOR_DAYS,
  type Recording,
  type RequestEvent,
  startRecording,
} from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import type { ZoomConfig } from "./config.js"
import { ZM } from "./read-only.js"

export interface RunSettings {
  record: boolean
  keepFailedRuns: boolean
  keepRunsForDays: number
}

/** `--record`/`--no-record` first, then the config; a failure is kept unless either says no. */
export const runSettings = (
  flag: boolean | undefined,
  config?: Pick<ZoomConfig, "record" | "keepRunsForDays">,
): RunSettings => {
  const record = flag ?? config?.record ?? false
  return {
    record,
    keepFailedRuns: record || (flag !== false && config?.record !== false),
    keepRunsForDays: config?.keepRunsForDays ?? KEEP_RUNS_FOR_DAYS,
  }
}

const SEGMENT = /^(?:v\d+|[a-z][a-z_]{0,23})$/

/**
 * `GET /v2/users/:id/recordings`: the method and the path's fixed words. A segment that is not one — a meeting
 * id, a uuid, an email, a download token — becomes `:id`, and the host and query are dropped.
 */
export const operationOf = (method: string, url: string): string => {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return `${method.toUpperCase()} :url`
  }
  const words = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const [head = "", verb] = segment.split(":")
      const base = SEGMENT.test(head) ? head : ":id"
      if (verb === undefined) return base
      return SEGMENT.test(verb) ? `${base}:${verb}` : base
    })
  return `${method.toUpperCase()} /${words.join("/")}`
}

export interface CommandRuns {
  start(action: Command, environment: BaseEnvironment, settings: RunSettings, profile: string): void
  succeed(): Promise<void>
  fail(error: unknown): Promise<void>
  /** The id the command's run has, kept or not, so its answer can name it. */
  runId(): string | undefined
  /** A fetch that logs each request's operation, status and duration into the command's run — never its content. */
  observe(fetcher: typeof fetch): typeof fetch
}

const commandWords = (action: Command): string[] => {
  const words: string[] = []
  for (let at: Command | null = action; at?.parent; at = at.parent) words.unshift(at.name())
  return words
}

export const commandRuns = (format: () => RenderFormat): CommandRuns => {
  let recording: Recording | undefined
  const event = (value: RequestEvent) => recording?.events(value)
  return {
    start(action, environment, settings, profile) {
      const words = commandWords(action)
      // Reading the log is not worth a run of its own, as in cli-core's `runs`.
      if (words[0] === "runs") return
      const command = `${environment.agent ? "mcp " : ""}${words.join(" ")}`
      recording = startRecording({
        app: ZM,
        command,
        profile,
        record: settings.record,
        keepFailed: settings.keepFailedRuns,
        keepDays: settings.keepRunsForDays,
        trace: false,
        format: format() === "pretty" ? "pretty" : "json",
        ...(environment.streams ? { streams: environment.streams } : {}),
        ...(environment.env ? { env: environment.env } : {}),
      })
    },
    runId: () => recording?.runId,
    async succeed() {
      const done = recording
      recording = undefined
      await done?.succeed()
    },
    async fail(error) {
      const done = recording
      recording = undefined
      await done?.fail(error)
    },
    observe: (fetcher) => async (input, init) => {
      const operation = operationOf(init?.method ?? "GET", input instanceof Request ? input.url : String(input))
      const started = Date.now()
      event({ event: "request", operation })
      try {
        const response = await fetcher(input, init)
        event({
          event: "response",
          operation,
          status: response.status,
          durationMs: Date.now() - started,
          outcome: response.status < 400 ? "ok" : "error",
        })
        return response
      } catch (error) {
        event({
          event: "response",
          operation,
          durationMs: Date.now() - started,
          outcome: "error",
          errorCode: isCliError(error) ? error.code : "network_error",
        })
        throw error
      }
    },
  }
}
