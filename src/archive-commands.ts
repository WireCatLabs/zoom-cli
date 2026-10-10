import { annotate } from "@wirecat/cli-core/commands"
import { listed } from "@wirecat/cli-meetings"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"
import type { inspectArchive, inspectArchiveLocks, recoverArchiveLocks, verifyArchive } from "./recording-archive.js"
import type { ZoomRecordings } from "./recordings.js"
import type { MeetingChange, MutationOptions, ZoomRemoteMeetings } from "./remote-meetings.js"

export type RecordingsService = Pick<ZoomRecordings, "list" | "show" | "download">
export type RemoteMeetingsService = Pick<
  ZoomRemoteMeetings,
  "list" | "show" | "invitation" | "create" | "update" | "cancel"
>
export interface ArchiveService {
  inspect: typeof inspectArchive
  verify: typeof verifyArchive
  locks: typeof inspectArchiveLocks
  recover: typeof recoverArchiveLocks
}
export interface ArchiveCommandsDeps {
  recordings: () => RecordingsService
  remoteMeetings: () => RemoteMeetingsService
  archive: ArchiveService
  signal: () => AbortSignal | undefined
  api: () => void
  output: (value: unknown) => void
  now: () => number
}
const label = (command: Command, example: string, mutation: "none" | "local" | "remote" = "none") =>
  annotate(command, {
    origin: "handwritten",
    mutates: mutation !== "none",
    ...(mutation === "none" ? {} : { local: mutation === "local" }),
    examples: [example],
  })
const positive = (text: string): number => {
  const value = bytes(text)
  if (value === 0) throw new ZoomError("validation_error", "expected a positive number")
  return value
}
const change = (options: MeetingChange): MeetingChange =>
  Object.fromEntries(
    ["topic", "startTime", "durationMinutes", "timezone", "agenda", "type"]
      .filter((key) => options[key as keyof MeetingChange] !== undefined)
      .map((key) => [key, options[key as keyof MeetingChange]]),
  )
const changes = (command: Command): Command =>
  command
    .option("--topic <text>", "meeting topic")
    .option("--start-time <timestamp>", "ISO start time with timezone")
    .option("--duration-minutes <minutes>", "positive meeting duration in minutes", positive)
    .option("--timezone <zone>", "IANA timezone")
    .option("--agenda <text>", "meeting agenda")
    .option("--type <type>", "instant (1) or scheduled (2)", positive)
    .option("--yes", "apply the remote mutation once instead of previewing")
    .option("--dry-run", "preview only, including when --yes is present")
const mutation = (options: MutationOptions & { yes?: boolean }, deps: ArchiveCommandsDeps): MutationOptions => {
  if (options.yes && !options.dryRun) deps.api()
  return { apply: options.yes, dryRun: options.dryRun, signal: deps.signal(), occurrenceId: options.occurrenceId }
}
export const addArchiveCommands = (program: Command, deps: ArchiveCommandsDeps): void => {
  const recordings = program.command("recordings").description("cloud recording assets and verified local archives")
  label(
    recordings
      .command("list")
      .description("list cloud recording occurrences (last 30 days by default)")
      .option("--from <date>", "first YYYY-MM-DD date")
      .option("--to <date>", "last YYYY-MM-DD date")
      .action(async (options: { from?: string; to?: string }) => {
        deps.api()
        const to = options.to ?? new Date(deps.now()).toISOString().slice(0, 10)
        const end = Date.parse(`${to}T00:00:00Z`)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== to)
          throw new ZoomError("validation_error", "to must be a real YYYY-MM-DD date")
        const from = options.from ?? new Date(end - 30 * 86400000).toISOString().slice(0, 10)
        deps.output(listed(await deps.recordings().list({ from, to, signal: deps.signal() })))
      }),
    "zm recordings list --from 2026-10-01 --to 2026-10-10 --json",
  )
  label(
    recordings
      .command("show")
      .description("show downloadable asset metadata without signed URLs")
      .argument("<meeting>", "meeting id or occurrence UUID")
      .action(async (id: string) => {
        deps.api()
        deps.output(await deps.recordings().show(id, { signal: deps.signal() }))
      }),
    "zm recordings show example-occurrence --json",
  )
  label(
    recordings
      .command("download")
      .description("stream recording assets into a verified local archive")
      .argument("<meeting>", "meeting id or occurrence UUID")
      .requiredOption("--destination <directory>", "explicit archive directory")
      .option("--file-ids <ids>", "comma-separated recording file ids")
      .option("--max-bytes <bytes>", "per-file download byte limit (default 20 GiB)", positive)
      .action(async (id: string, options: { destination: string; fileIds?: string; maxBytes?: number }) => {
        deps.api()
        deps.output(
          await deps.recordings().download(id, {
            destination: options.destination,
            fileIds: options.fileIds?.split(",").map((one) => one.trim()),
            maxBytes: options.maxBytes,
            signal: deps.signal(),
          }),
        )
      }),
    "zm recordings download example-occurrence --destination ./zoom-archive --json",
    "local",
  )
  const archive = recordings.command("archive").description("inspect archives without Zoom or a database")
  label(
    archive
      .command("inspect")
      .description("read local transfer manifests")
      .argument("<directory>")
      .action(async (directory: string) =>
        deps.output(listed(await deps.archive.inspect(directory, { signal: deps.signal() }))),
      ),
    "zm recordings archive inspect ./zoom-archive --json",
  )
  label(
    archive
      .command("verify")
      .description("verify local file sizes and checksums")
      .argument("<directory>")
      .action(async (directory: string) =>
        deps.output(listed(await deps.archive.verify(directory, { signal: deps.signal() }))),
      ),
    "zm recordings archive verify ./zoom-archive --json",
  )
  label(
    archive
      .command("locks")
      .description("inspect active, stale or foreign archive locks")
      .argument("<directory>")
      .action(async (directory: string) =>
        deps.output(listed(await deps.archive.locks(directory, { signal: deps.signal() }))),
      ),
    "zm recordings archive locks ./zoom-archive --json",
  )
  label(
    archive
      .command("recover")
      .description("preview recovery of recognized stale local locks")
      .argument("<directory>")
      .option("--yes", "remove recognized locks left by a dead local process")
      .option("--dry-run", "preview only, including when --yes is present")
      .action(async (directory: string, options: { yes?: boolean; dryRun?: boolean }) =>
        deps.output(
          await deps.archive.recover(directory, {
            apply: options.yes === true && !options.dryRun,
            signal: deps.signal(),
          }),
        ),
      ),
    "zm recordings archive recover ./zoom-archive --dry-run --json",
    "local",
  )

  const remote = program
    .command("remote-meetings")
    .description("upcoming Zoom meetings; stored meeting reads remain under meetings")
  label(
    remote
      .command("list")
      .description("list upcoming meetings")
      .action(async () => {
        deps.api()
        deps.output(listed(await deps.remoteMeetings().list({ signal: deps.signal() })))
      }),
    "zm remote-meetings list --json",
  )
  label(
    remote
      .command("show")
      .description("show an upcoming meeting")
      .argument("<meeting>", "positive numeric Zoom meeting id")
      .action(async (id: string) => {
        deps.api()
        deps.output(await deps.remoteMeetings().show(id, { signal: deps.signal() }))
      }),
    "zm remote-meetings show 123456789 --json",
  )
  label(
    remote
      .command("invitation")
      .description("read invitation text")
      .argument("<meeting>", "positive numeric Zoom meeting id")
      .action(async (id: string) => {
        deps.api()
        deps.output(await deps.remoteMeetings().invitation(id, { signal: deps.signal() }))
      }),
    "zm remote-meetings invitation 123456789 --json",
  )
  label(
    changes(remote.command("create").description("preview a meeting creation; --yes performs it once")).action(
      async (options: MeetingChange & MutationOptions & { yes?: boolean }) =>
        deps.output(await deps.remoteMeetings().create(change(options), mutation(options, deps))),
    ),
    'zm remote-meetings create --topic "Example planning" --start-time 2026-10-10T15:30:00Z --dry-run --json',
    "remote",
  )
  label(
    changes(
      remote
        .command("update")
        .description("preview a meeting update; --yes performs it once")
        .argument("<meeting>", "positive numeric Zoom meeting id"),
    ).action(async (id: string, options: MeetingChange & MutationOptions & { yes?: boolean }) =>
      deps.output(await deps.remoteMeetings().update(id, change(options), mutation(options, deps))),
    ),
    'zm remote-meetings update 123456789 --topic "Example planning" --dry-run --json',
    "remote",
  )
  label(
    remote
      .command("cancel")
      .description("preview a cancellation; --yes performs it once")
      .argument("<meeting>", "positive numeric Zoom meeting id")
      .option("--occurrence-id <id>", "cancel one recurring occurrence")
      .option("--yes", "apply cancellation once instead of previewing")
      .option("--dry-run", "preview only, including when --yes is present")
      .action(async (id: string, options: MutationOptions & { yes?: boolean }) =>
        deps.output(await deps.remoteMeetings().cancel(id, mutation(options, deps))),
      ),
    "zm remote-meetings cancel 123456789 --dry-run --json",
    "remote",
  )
}
