import { join } from "node:path"
import { createRecordLog, type Logger } from "@wirecat/cli-base"
import { startRun } from "@wirecat/cli-core/cli"

type RunStatus = Parameters<ReturnType<typeof startRun>["finish"]>[0]

export interface RunLogOptions {
  runsDir: string
  command: string
  version: string
  allow: readonly string[]
  onError?: (error: Error) => void
}
export interface RunLog {
  log: Logger
  finish(status: RunStatus): Promise<void>
}

// Opens the run on its first event, so a command that logs nothing leaves no run directory behind.
// startRun's own logger allows only cli-core's keys, so zm's records go through createRecordLog with
// zm's allow-list, into the same events.jsonl.
export const lazyRunLog = (options: RunLogOptions): RunLog => {
  let opened: { finish: (status: RunStatus) => Promise<void>; log: Logger } | undefined
  let failed = false
  const open = (): Logger | undefined => {
    if (failed) return undefined
    try {
      if (!opened) {
        const resource = { service: "zm", version: options.version }
        const run = startRun({
          runsDir: options.runsDir,
          command: options.command,
          profile: "",
          service: resource.service,
          cliVersion: options.version,
          ...(options.onError ? { onError: options.onError } : {}),
        })
        const log = createRecordLog({
          to: join(run.dir, "events.jsonl"),
          runId: run.id,
          command: options.command,
          resource,
          allow: options.allow,
          ...(options.onError ? { onError: options.onError } : {}),
        })
        opened = { finish: (status) => run.finish(status), log }
      }
      return opened.log
    } catch (error) {
      failed = true
      options.onError?.(error instanceof Error ? error : new Error("could not open the run log"))
      return undefined
    }
  }
  const at =
    (level: keyof Logger) =>
    (event: object): void =>
      open()?.[level](event)
  return {
    log: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") },
    finish: async (status) => {
      await opened?.finish(status)
    },
  }
}
