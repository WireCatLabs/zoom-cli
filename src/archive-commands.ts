import { annotate } from "@wirecat/cli-base/commands"
import { listed, recordingWindows } from "@wirecat/cli-core/meetings"
import type { Command } from "commander"
import type { readArchiveTranscripts, searchArchiveTranscripts } from "./archive-transcripts.js"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"
import type { inspectArchive, inspectArchiveLocks, recoverArchiveLocks, verifyArchive } from "./recording-archive.js"
import { validateDownloadOptions } from "./recording-archive.js"
import { syncRecordingArchive } from "./recording-sync.js"
import type { ZoomRecordings } from "./recordings.js"
import type { MeetingChange, MutationOptions, ZoomRemoteMeetings } from "./remote-meetings.js"

export type RecordingsService = Pick<ZoomRecordings, "list" | "show" | "download"> &
  Partial<Pick<ZoomRecordings, "catalog">>
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
export interface ArchiveTranscriptService {
  read: typeof readArchiveTranscripts
  search: typeof searchArchiveTranscripts
}
export interface ArchiveCommandsDeps {
  recordings: () => RecordingsService
  remoteMeetings: () => RemoteMeetingsService
  archive: ArchiveService
  transcripts: ArchiveTranscriptService
  signal: () => AbortSignal | undefined
  api: () => void
  account?: () => string | undefined
  output: (value: unknown) => void
  outputItems: (values: AsyncIterable<unknown>) => Promise<void>
  receipt: (value: unknown) => Promise<void>
  outputIsTTY?: boolean
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
const discoveryLimit = (text: string): number => {
  const value = positive(text)
  if (value > 10000) throw new ZoomError("validation_error", "archive discovery limit must be between 1 and 10000")
  return value
}
const archiveScope = (deps: ArchiveCommandsDeps, options: { resume?: boolean; checkpoint?: string }) => {
  const account = deps.account?.()
  const resume = options.resume ?? (options.checkpoint !== undefined || account !== undefined)
  if (resume && !account)
    throw new ZoomError(
      "configuration_error",
      "resumable archives require a local profile; run zm config set account.profile <label>",
    )
  if (options.checkpoint !== undefined && !resume)
    throw new ZoomError("validation_error", "archive checkpoints require resume mode; remove --no-resume")
  if (options.checkpoint !== undefined && !options.checkpoint.trim())
    throw new ZoomError("validation_error", "archive checkpoint path must be nonempty")
  return { ...(account === undefined ? {} : { account }), resume }
}
const resumable = (command: Command): Command =>
  command
    .option("--resume", "resume verified partial downloads and archive progress; requires a local profile")
    .option("--no-resume", "disable persistent resume state for this invocation")
type ChangeOptions = Omit<MeetingChange, "topic"> & { title?: string }
const change = ({ title, ...options }: ChangeOptions): MeetingChange =>
  Object.fromEntries(
    Object.entries({ topic: title, ...options }).filter(
      ([key, value]) =>
        value !== undefined && ["topic", "startTime", "durationMinutes", "timezone", "agenda", "type"].includes(key),
    ),
  )
const changes = (command: Command): Command =>
  command
    .option("--title <text>", "meeting title")
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
      .option("--since-time <time>", "first day, YYYY-MM-DD")
      .option("--until-time <time>", "last day, YYYY-MM-DD")
      .action(async (options: { sinceTime?: string; untilTime?: string }) => {
        deps.api()
        const to = options.untilTime ?? new Date(deps.now()).toISOString().slice(0, 10)
        const end = Date.parse(`${to}T00:00:00Z`)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== to)
          throw new ZoomError("validation_error", "--until-time must be a real YYYY-MM-DD date")
        const from = options.sinceTime ?? new Date(end - 30 * 86400000).toISOString().slice(0, 10)
        deps.output(listed(await deps.recordings().list({ from, to, signal: deps.signal() })))
      }),
    "zm recordings list --since-time 2026-10-01 --until-time 2026-10-10 --json",
  )
  label(
    resumable(
      recordings
        .command("sync")
        .description("download a date range of recordings into an archive folder, a month at a time")
        .requiredOption("--since-time <time>", "first day, YYYY-MM-DD")
        .requiredOption("--until-time <time>", "last day, YYYY-MM-DD; at most ten years after the first")
        .requiredOption("--destination <directory>", "explicit archive directory")
        .option("--max-bytes <bytes>", "maximum bytes per recording file", positive),
    )
      .option("--checkpoint <file>", "explicit durable checkpoint file; implies resume")
      .option("--recheck-since-time <time>", "look again from this day, YYYY-MM-DD, for recordings that came late")
      .option("--max-pages <pages>", "catalog page limit from 1 through 10000 (default 1000)", discoveryLimit)
      .option("--max-entries <entries>", "occurrence limit from 1 through 10000 (default 10000)", discoveryLimit)
      .action(
        async (options: {
          sinceTime: string
          untilTime: string
          destination: string
          maxBytes?: number
          resume?: boolean
          checkpoint?: string
          recheckSinceTime?: string
          maxPages?: number
          maxEntries?: number
        }) => {
          if (!program.opts().jsonl && !deps.outputIsTTY)
            throw new ZoomError("validation_error", "headless recording sync requires --jsonl")
          if (program.opts().json)
            throw new ZoomError("validation_error", "recording sync streams receipts; use --jsonl")
          const scope = archiveScope(deps, options)
          recordingWindows(options.sinceTime, options.untilTime)
          if (options.recheckSinceTime !== undefined)
            recordingWindows(options.recheckSinceTime, options.recheckSinceTime)
          validateDownloadOptions({ ...options, ...scope })
          deps.api()
          for await (const receipt of syncRecordingArchive(deps.recordings(), {
            from: options.sinceTime,
            to: options.untilTime,
            destination: options.destination,
            ...scope,
            maxBytes: options.maxBytes,
            checkpointPath: options.checkpoint,
            recheckFrom: options.recheckSinceTime,
            maxPages: options.maxPages,
            maxEntries: options.maxEntries,
            now: deps.now,
            signal: deps.signal(),
          }))
            await deps.receipt(receipt)
        },
      ),
    "zm recordings sync --since-time 2026-01-01 --until-time 2026-10-10 --destination ./archive --jsonl",
    "local",
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
    resumable(
      recordings
        .command("download")
        .description("stream recording assets into a verified local archive")
        .argument("<meeting>", "meeting id or occurrence UUID")
        .requiredOption("--destination <directory>", "explicit archive directory")
        .option("--file-ids <ids>", "comma-separated recording file ids")
        .option("--max-bytes <bytes>", "per-file download byte limit (default 20 GiB)", positive),
    ).action(
      async (id: string, options: { destination: string; fileIds?: string; maxBytes?: number; resume?: boolean }) => {
        const request = {
          destination: options.destination,
          fileIds: options.fileIds?.split(",").map((one) => one.trim()),
          maxBytes: options.maxBytes,
          ...archiveScope(deps, options),
          signal: deps.signal(),
        }
        validateDownloadOptions(request)
        deps.api()
        deps.output(await deps.recordings().download(id, request))
      },
    ),
    "zm recordings download example-occurrence --destination ./zoom-archive --json",
    "local",
  )
  const archive = recordings.command("archive").description("inspect archives without Zoom or a database")
  const transcriptOptions = (command: Command) =>
    command
      .option("--uuid <uuid>", "select an occurrence UUID")
      .option("--file-ids <ids>", "select comma-separated transcript asset ids")
      .option("--max-bytes <bytes>", "largest transcript file to read, in bytes (default 8 MiB)", positive)
  const selected = (options: { uuid?: string; fileIds?: string; maxBytes?: number }) => ({
    uuid: options.uuid,
    fileIds: options.fileIds?.split(",").map((id) => id.trim()),
    maxBytes: options.maxBytes,
    signal: deps.signal(),
  })
  label(
    transcriptOptions(
      archive
        .command("transcript")
        .description("read the transcripts of a local archive, checking each file first")
        .argument("<directory>", "archive folder"),
    ).action(async (directory: string, options: { uuid?: string; fileIds?: string; maxBytes?: number }) => {
      await deps.outputItems(deps.transcripts.read(directory, selected(options)))
    }),
    "zm recordings archive transcript ./zoom-archive --uuid example-occurrence --json",
  )
  label(
    archive
      .command("show")
      .description("show what a local archive holds, from its transfer records")
      .argument("<directory>", "archive folder")
      .action(async (directory: string) =>
        deps.output(listed(await deps.archive.inspect(directory, { signal: deps.signal() }))),
      ),
    "zm recordings archive show ./zoom-archive --json",
  )
  label(
    archive
      .command("check")
      .description("check the size and checksum of every file in a local archive")
      .argument("<directory>", "archive folder")
      .action(async (directory: string) =>
        deps.output(listed(await deps.archive.verify(directory, { signal: deps.signal() }))),
      ),
    "zm recordings archive check ./zoom-archive --json",
  )
  label(
    archive
      .command("locks")
      .description("list the locks on a local archive: active, stale or another machine's")
      .argument("<directory>", "archive folder")
      .action(async (directory: string) =>
        deps.output(listed(await deps.archive.locks(directory, { signal: deps.signal() }))),
      ),
    "zm recordings archive locks ./zoom-archive --json",
  )
  label(
    archive
      .command("recover")
      .description("preview removing stale locks; --yes removes them")
      .argument("<directory>", "archive folder")
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
      async (options: ChangeOptions & MutationOptions & { yes?: boolean }) =>
        deps.output(await deps.remoteMeetings().create(change(options), mutation(options, deps))),
    ),
    'zm remote-meetings create --title "Example planning" --start-time 2026-10-10T15:30:00Z --dry-run --json',
    "remote",
  )
  label(
    changes(
      remote
        .command("update")
        .description("preview a meeting update; --yes performs it once")
        .argument("<meeting>", "positive numeric Zoom meeting id"),
    ).action(async (id: string, options: ChangeOptions & MutationOptions & { yes?: boolean }) =>
      deps.output(await deps.remoteMeetings().update(id, change(options), mutation(options, deps))),
    ),
    'zm remote-meetings update 123456789 --title "Example planning" --dry-run --json',
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
