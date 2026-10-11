import { annotate } from "@wirecat/cli-base/commands"
import { listed } from "@wirecat/cli-messaging/meetings"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"
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
    output: (value: unknown) => void
    receipt: (value: unknown) => Promise<void>
    outputIsTTY?: boolean
  },
): void => {
  const deliver = async (value: RecordingScheduleReceipt) => {
    if (value.applied) await deps.receipt(value)
    else deps.output(value)
  }
  const recordings = program.commands.find((command) => command.name() === "recordings")
  if (!recordings) throw new ZoomError("configuration_error", "recording command group is unavailable")
  const schedule = recordings.command("schedule").description("local archive jobs and Linux user systemd timers")
  const label = (command: Command, example: string, mutates = false) =>
    annotate(command, { origin: "handwritten", mutates, ...(mutates ? { local: true } : {}), examples: [example] })
  label(
    schedule
      .command("create")
      .description("preview a captured daily archive job; --yes installs its user timer")
      .requiredOption("--name <name>", "local job name")
      .requiredOption("--destination <directory>", "absolute archive directory")
      .requiredOption("--from <date>", "first YYYY-MM-DD archive date")
      .requiredOption("--at <time>", "daily HH:mm time")
      .requiredOption("--timezone <zone>", "IANA timezone for the timer")
      .option("--lookback-days <days>", "revisit the latest zero through 31 UTC days (default seven)", bytes)
      .option("--max-bytes <bytes>", "maximum bytes per recording file (default 20 GiB)", bytes)
      .option("--yes", "install and enable the captured timer")
      .option("--dry-run", "preview even when --yes is present")
      .action(
        async (options: {
          name: string
          destination: string
          from: string
          at: string
          timezone: string
          lookbackDays?: number
          maxBytes?: number
          yes?: boolean
          dryRun?: boolean
        }) => {
          const offline = deps.offline()
          if (options.yes && !options.dryRun && offline)
            throw new ZoomError("configuration_error", "archive schedule installation requires online mode")
          const capture = deps.capture()
          const service = deps.service()
          await deliver(
            await service.create(
              {
                name: options.name,
                destination: options.destination,
                from: options.from,
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
    "zm recordings schedule create --name daily --destination /home/AliceExample/archive --from 2026-01-01 --at 03:15 --timezone UTC --json",
    true,
  )
  label(
    schedule
      .command("list")
      .description("list saved local jobs; live timer state is not checked")
      .action(async () => {
        deps.output(listed(await deps.service().list({ signal: deps.signal() })))
      }),
    "zm recordings schedule list --offline --json",
  )
  label(
    schedule
      .command("show")
      .description("show one saved local job and its captured settings")
      .argument("<id>", "schedule id")
      .action(async (id: string) => {
        deps.output(await deps.service().show(id, { signal: deps.signal() }))
      }),
    "zm recordings schedule show <schedule-id> --offline --json",
  )
  label(
    schedule
      .command("run")
      .description("run the captured job once with durable archive progress")
      .argument("<id>", "schedule id")
      .action(async (id: string) => {
        if (program.opts().json || (!program.opts().jsonl && !deps.outputIsTTY))
          throw new ZoomError("validation_error", "headless archive schedule runs stream receipts; use --jsonl")
        if (deps.offline()) throw new ZoomError("configuration_error", "archive schedule run requires online mode")
        for await (const receipt of deps.service().run(id, { offline: deps.offline(), signal: deps.signal() }))
          await deps.receipt(receipt)
      }),
    "zm recordings schedule run <schedule-id> --jsonl",
    true,
  )
  label(
    schedule
      .command("disable")
      .description("preview disabling a saved timer; --yes disables it without deleting files")
      .argument("<id>", "schedule id")
      .option("--yes", "disable and stop the timer")
      .option("--dry-run", "preview even when --yes is present")
      .action(async (id: string, options: { yes?: boolean; dryRun?: boolean }) => {
        await deliver(
          await deps.service().disable(id, { apply: options.yes, dryRun: options.dryRun, signal: deps.signal() }),
        )
      }),
    "zm recordings schedule disable <schedule-id> --yes --json",
    true,
  )
}
