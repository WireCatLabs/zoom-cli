import { annotate } from "@wirecat/cli-base/commands"
import { type RunReport, type WatchSleep, watchMeetingIngestion } from "@wirecat/cli-messaging/meetings"
import { type Command, Option } from "commander"
import { ZoomError } from "./errors.js"
import { duration } from "./execution.js"

export interface WatchFlags {
  source?: "api" | "files"
  since?: string
  lookbackDays?: number
  interval: number
}
export interface WatchPlan {
  source: "api" | "files"
  folder?: string
  since?: string
  lookbackDays: number
  intervalMs: number
}
export interface WatchCommandDeps {
  signal: () => AbortSignal
  prepare: (folder: string | undefined, flags: WatchFlags) => WatchPlan
  ingest: (plan: WatchPlan, signal: AbortSignal) => Promise<RunReport>
  receipt: (report: RunReport) => Promise<void>
  sleep?: WatchSleep
  outputIsTTY?: boolean
}
const days = (value: string): number => {
  if (!/^\d+$/.test(value) || Number(value) > 31)
    throw new ZoomError("validation_error", "lookback days must be an integer from 0 through 31")
  return Number(value)
}
const since = (value: string): string => {
  const day = value.slice(0, 10)
  const dayTime = Date.parse(`${day}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(dayTime) ||
    new Date(dayTime).toISOString().slice(0, 10) !== day
  )
    throw new ZoomError("validation_error", "since must be a real ISO timestamp with timezone")
  return value
}
export const addWatchCommand = (program: Command, deps: WatchCommandDeps): void => {
  const command = program
    .command("watch")
    .description("foreground serial API pulls or folder rescans, with closed-store receipts")
    .argument("[folder]", "downloaded VTT/TXT folder; defaults source to files")
    .addOption(
      new Option("--source <source>", "api or files; otherwise uses configured source").choices(["api", "files"]),
    )
    .option("--since <timestamp>", "initial API lower bound until the first successful cursor write", since)
    .option("--lookback-days <days>", "API cursor overlap for late transcripts (0 through 31)", days)
    .option("--interval <duration>", "delay after each completed receipt (1s through 24h)", duration, 10000)
    .action(async (folder: string | undefined, options: WatchFlags) => {
      if (!program.opts().jsonl && !deps.outputIsTTY)
        throw new ZoomError("validation_error", "headless watch requires --jsonl")
      if (program.opts().json) throw new ZoomError("validation_error", "watch streams receipts; use --jsonl")
      if (options.interval < 1000 || options.interval > 86400000)
        throw new ZoomError("validation_error", "watch interval must be from 1s through 24h")
      const plan = deps.prepare(folder, options)
      for await (const report of watchMeetingIngestion((signal) => deps.ingest(plan, signal), {
        signal: deps.signal(),
        intervalMs: plan.intervalMs,
        sleep: deps.sleep,
      }))
        await deps.receipt(report)
    })
  annotate(command, {
    origin: "handwritten",
    mutates: true,
    local: true,
    examples: ["zm watch ./downloads --interval 10s --jsonl", "zm watch --source api --lookback-days 2 --jsonl"],
  })
}
