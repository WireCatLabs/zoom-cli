import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import type { Effects } from "@wirecat/cli-base/standards"
import { type Body, FETCH, itemOf, LOCAL_READ, LOCAL_WRITE, NO_EFFECTS } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { wholeList } from "./answer-output.js"
import { bytes, runsLong } from "./execution.js"
import type {
  RecordingScheduleCapture,
  RecordingScheduleReceipt,
  RecordingScheduleService,
} from "./recording-schedule.js"

export const addRecordingScheduleCommands = (
  program: Command,
  deps: {
    service: () => RecordingScheduleService
    capture: () => RecordingScheduleCapture
    offline: () => boolean
    signal: () => AbortSignal | undefined
    output: (body: Body) => void
    receipt: (body: Body) => Promise<void>
    outputIsTTY?: boolean
  },
): void => {
  const deliver = async (value: RecordingScheduleReceipt) => {
    if (value.applied) await deps.receipt(itemOf(value))
    else deps.output(itemOf(value))
  }
  const recordings = program.commands.find((command) => command.name() === "recordings")
  if (!recordings) throw new CliError("configuration_error", "recording command group is unavailable")
  const schedule = annotate(recordings.command("schedule"), { effects: NO_EFFECTS }).description(
    "local archive jobs and Linux user systemd timers",
  )
  const label = (command: Command, example: string, effects: Effects) =>
    annotate(command, { origin: "handwritten", effects, examples: [example] })
  label(
    schedule
      .command("create")
      .description("preview a daily archive job; --yes installs its timer")
      .requiredOption("--name <name>", "local job name")
      .requiredOption("--output-dir <dir>", "absolute archive directory")
      .requiredOption("--since-time <time>", "first day to archive, YYYY-MM-DD")
      .requiredOption("--at <hh:mm>", "daily time")
      .requiredOption("--timezone <zone>", "IANA timezone for the timer")
      .option("--lookback-days <days>", "revisit the latest zero through 31 UTC days (default seven)", bytes)
      .option("--max-bytes <bytes>", "maximum bytes per recording file (default 20 GiB)", bytes)
      .option("--yes", "install and enable the captured timer")
      .option("--dry-run", "preview even when --yes is present")
      .action(
        async (options: {
          name: string
          outputDir: string
          sinceTime: string
          at: string
          timezone: string
          lookbackDays?: number
          maxBytes?: number
          yes?: boolean
          dryRun?: boolean
        }) => {
          const offline = deps.offline()
          if (options.yes && !options.dryRun && offline)
            throw new CliError("configuration_error", "archive schedule installation requires online mode")
          const capture = deps.capture()
          const service = deps.service()
          await deliver(
            await service.create(
              {
                name: options.name,
                destination: options.outputDir,
                from: options.sinceTime,
                dailyAt: options.at,
                timeZone: options.timezone,
                lookbackDays: options.lookbackDays,
                maxBytes: options.maxBytes,
              },
              capture,
              { apply: options.yes, dryRun: options.dryRun, offline, signal: deps.signal() },
            ),
          )
        },
      ),
    "zm recordings schedule create --name daily --output-dir /home/AliceExample/archive --since-time 2026-01-01 --at 03:15 --timezone UTC --json",
    LOCAL_WRITE,
  )
  label(
    schedule
      .command("list")
      .description("list saved local jobs; live timer state is not checked")
      .action(async () => {
        deps.output(wholeList("recordings schedule list", await deps.service().list({ signal: deps.signal() })))
      }),
    "zm recordings schedule list --offline --json",
    LOCAL_READ,
  )
  label(
    schedule
      .command("show")
      .description("show one saved local job and its captured settings")
      .argument("<job>", "saved job id")
      .action(async (id: string) => {
        deps.output(itemOf(await deps.service().show(id, { signal: deps.signal() })))
      }),
    "zm recordings schedule show example-job --offline --json",
    LOCAL_READ,
  )
  label(
    runsLong(schedule.command("run"))
      .description("run the captured job once with durable archive progress")
      .argument("<job>", "saved job id")
      .action(async (id: string) => {
        if (program.opts().json || (!program.opts().jsonl && !deps.outputIsTTY))
          throw new CliError("validation_error", "headless archive schedule runs stream receipts; use --jsonl")
        if (deps.offline()) throw new CliError("configuration_error", "archive schedule run requires online mode")
        for await (const receipt of deps.service().run(id, { offline: deps.offline(), signal: deps.signal() }))
          await deps.receipt(itemOf(receipt))
      }),
    "zm recordings schedule run example-job --jsonl",
    FETCH,
  )
  label(
    schedule
      .command("disable")
      .description("preview disabling a saved timer; --yes disables it without deleting files")
      .argument("<job>", "saved job id")
      .option("--yes", "disable and stop the timer")
      .option("--dry-run", "preview even when --yes is present")
      .action(async (id: string, options: { yes?: boolean; dryRun?: boolean }) => {
        await deliver(
          await deps.service().disable(id, { apply: options.yes, dryRun: options.dryRun, signal: deps.signal() }),
        )
      }),
    "zm recordings schedule disable example-job --yes --json",
    LOCAL_WRITE,
  )
}
