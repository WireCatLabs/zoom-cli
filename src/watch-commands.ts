import { annotate } from "@wirecat/cli-core/commands"
import { type RunReport, type WatchSleep, watchMeetingIngestion } from "@wirecat/cli-meetings"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { duration } from "./execution.js"

export interface WatchCommandDeps {
  signal: () => AbortSignal
  ingest: (folder: string, signal: AbortSignal) => Promise<RunReport>
  receipt: (report: RunReport) => Promise<void>
  sleep?: WatchSleep
  outputIsTTY?: boolean
}
export const addWatchCommand = (program: Command, deps: WatchCommandDeps): void => {
  const command = program
    .command("watch")
    .description("foreground serial folder rescans; completed receipts stream after each store close")
    .argument("<folder>", "downloaded VTT/TXT folder")
    .option("--interval <duration>", "delay after each completed receipt (1s through 24h)", duration, 10000)
    .action(async (folder: string, options: { interval: number }) => {
      if (!program.opts().jsonl && !deps.outputIsTTY)
        throw new ZoomError("validation_error", "headless watch requires --jsonl")
      if (program.opts().json) throw new ZoomError("validation_error", "watch streams receipts; use --jsonl")
      for await (const report of watchMeetingIngestion((signal) => deps.ingest(folder, signal), {
        signal: deps.signal(),
        intervalMs: options.interval,
        sleep: deps.sleep,
      }))
        await deps.receipt(report)
    })
  annotate(command, {
    origin: "handwritten",
    mutates: true,
    local: true,
    examples: ["zm watch ./downloads --interval 10s --jsonl"],
  })
}
