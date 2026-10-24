import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { timezoneOf } from "@wirecat/cli-base/query"
import type { Effects } from "@wirecat/cli-base/standards"
import {
  type Body,
  FETCH,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  listQuery,
  NO_EFFECTS,
  REMOTE_READ,
  REMOTE_WRITE,
  typedQuery,
  unfilteredQuery,
  withQuery,
} from "@wirecat/cli-core/cli"
import { recordingWindows } from "@wirecat/cli-core/meetings"
import type { Command } from "commander"
import { ZOOM_ANSWER_ENTITIES } from "./answer-entities.js"
import { wholeList } from "./answer-output.js"
import type { readArchiveTranscripts, searchArchiveTranscripts } from "./archive-transcripts.js"
import { bytes, runsLong } from "./execution.js"
import type { inspectArchiveLocks, recoverArchiveLocks } from "./recording-archive.js"
import { validateDownloadOptions } from "./recording-archive.js"
import type { inspectArchive, verifyArchive } from "./recording-manifest.js"
import { syncRecordingArchive } from "./recording-sync.js"
import type { ZoomRecordings } from "./recordings.js"
import type { MeetingChange, MutationOptions, ZoomRemoteMeetings } from "./remote-meetings.js"

export type RecordingsService = Pick<ZoomRecordings, "list" | "show" | "download" | "catalog">
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
  account: () => string | undefined
  output: (body: Body) => void
  outputItems: (values: AsyncIterable<unknown>) => Promise<void>
  receipt: (body: Body) => Promise<void>
  outputIsTTY?: boolean
  now: () => number
}
const label = (command: Command, example: string, effects: Effects) =>
  annotate(command, { origin: "handwritten", effects, examples: [example] })
const positive = (text: string): number => {
  const value = bytes(text)
  if (value === 0) throw new CliError("validation_error", "expected a positive number")
  return value
}
const discoveryLimit = (text: string): number => {
  const value = positive(text)
  if (value > 10000) throw new CliError("validation_error", "archive discovery limit must be between 1 and 10000")
  return value
}
const archiveScope = (deps: ArchiveCommandsDeps, options: { resume?: boolean; checkpoint?: string }) => {
  const account = deps.account()
  if (!account)
    throw new CliError("configuration_error", "recording archives belong to a profile: `zm <profile> recordings …`")
  const resume = options.resume ?? true
  if (options.checkpoint !== undefined && !resume)
    throw new CliError("validation_error", "archive checkpoints require resume mode; remove --no-resume")
  if (options.checkpoint !== undefined && !options.checkpoint.trim())
    throw new CliError("validation_error", "archive checkpoint path must be nonempty")
  return { account, resume }
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
    .option("--title <title>", "meeting title")
    .option("--start-time <time>", "ISO start time with timezone")
    .option("--duration-minutes <minutes>", "positive meeting duration in minutes", positive)
    .option("--timezone <zone>", "IANA timezone")
    .option("--agenda <text>", "meeting agenda")
    .option("--type <type>", "instant (1) or scheduled (2)", positive)
    .option("--yes", "apply the change without asking first")
    .option("--dry-run", "preview only, including when --yes is present")
const mutation = (options: MutationOptions & { yes?: boolean }, deps: ArchiveCommandsDeps): MutationOptions => {
  if (options.yes && !options.dryRun) deps.api()
  return { apply: options.yes, dryRun: options.dryRun, signal: deps.signal(), occurrenceId: options.occurrenceId }
}
const localZone = (given?: string): string => {
  try {
    return timezoneOf(given)
  } catch {
    throw new CliError("validation_error", "--timezone must be an IANA timezone such as Europe/Madrid")
  }
}
const localDay = (now: number, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
export const addArchiveCommands = (program: Command, deps: ArchiveCommandsDeps): void => {
  const recordings = annotate(program.command("recordings"), { effects: NO_EFFECTS }).description(
    "cloud recording assets and verified local archives",
  )
  const recordingsQuery = unfilteredQuery("zoom_recording", ZOOM_ANSWER_ENTITIES["recordings list"].schema)
  label(
    withQuery(recordings.command("list"), recordingsQuery)
      .description("list cloud recording occurrences (last 30 days by default)")
      .option("--since-time <time>", "first day, YYYY-MM-DD")
      .option("--until-time <time>", "last day, YYYY-MM-DD (default today in --timezone)")
      .option("--timezone <zone>", "IANA timezone of today (default the computer's)")
      .action(async (words: string[], options: { sinceTime?: string; untilTime?: string; timezone?: string }) => {
        listQuery(typedQuery(words), recordingsQuery, "recordings list")
        deps.api()
        const zone = localZone(options.timezone)
        const to = options.untilTime ?? localDay(deps.now(), zone)
        const end = Date.parse(`${to}T00:00:00Z`)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== to)
          throw new CliError("validation_error", "--until-time must be a real YYYY-MM-DD date")
        const from = options.sinceTime ?? new Date(end - 30 * 86400000).toISOString().slice(0, 10)
        const list = wholeList("recordings list", await deps.recordings().list({ from, to, signal: deps.signal() }))
        deps.output(options.untilTime === undefined ? { ...list, meta: { timezone: zone } } : list)
      }),
    "zm personal recordings list --since-time 2026-10-01 --until-time 2026-10-10 --json",
    REMOTE_READ,
  )
  label(
    resumable(
      runsLong(recordings.command("sync"))
        .description("download a date range of recordings into an archive folder, a month at a time")
        .requiredOption("--since-time <time>", "first day, YYYY-MM-DD")
        .requiredOption("--until-time <time>", "last day, YYYY-MM-DD; at most ten years after the first")
        .requiredOption("--output-dir <dir>", "explicit archive directory")
        .option("--max-bytes <bytes>", "maximum bytes per recording file", positive),
    )
      .option("--checkpoint <file>", "explicit durable checkpoint file; implies resume")
      .option("--recheck-since-time <time>", "look again from this day, YYYY-MM-DD, for recordings that came late")
      .option("--max-pages <pages>", "catalog page limit from 1 through 10000 (default 1000)", discoveryLimit)
      .option("--max-entries <n>", "occurrence limit from 1 through 10000 (default 10000)", discoveryLimit)
      .action(
        async (options: {
          sinceTime: string
          untilTime: string
          outputDir: string
          maxBytes?: number
          resume?: boolean
          checkpoint?: string
          recheckSinceTime?: string
          maxPages?: number
          maxEntries?: number
        }) => {
          if (!program.opts().jsonl && !deps.outputIsTTY)
            throw new CliError("validation_error", "headless recording sync requires --jsonl")
          if (program.opts().json)
            throw new CliError("validation_error", "recording sync streams receipts; use --jsonl")
          const scope = archiveScope(deps, options)
          recordingWindows(options.sinceTime, options.untilTime)
          if (options.recheckSinceTime !== undefined)
            recordingWindows(options.recheckSinceTime, options.recheckSinceTime)
          validateDownloadOptions({ ...options, destination: options.outputDir, ...scope })
          deps.api()
          for await (const receipt of syncRecordingArchive(deps.recordings(), {
            from: options.sinceTime,
            to: options.untilTime,
            destination: options.outputDir,
            ...scope,
            maxBytes: options.maxBytes,
            checkpointPath: options.checkpoint,
            recheckFrom: options.recheckSinceTime,
            maxPages: options.maxPages,
            maxEntries: options.maxEntries,
            now: deps.now,
            signal: deps.signal(),
          }))
            await deps.receipt(itemOf(receipt))
        },
      ),
    "zm personal recordings sync --since-time 2026-01-01 --until-time 2026-10-10 --output-dir ./archive --jsonl",
    FETCH,
  )
  label(
    recordings
      .command("show")
      .description("show downloadable asset metadata without signed URLs")
      .argument("<meeting>", "meeting id or occurrence UUID")
      .action(async (id: string) => {
        deps.api()
        deps.output(itemOf(await deps.recordings().show(id, { signal: deps.signal() })))
      }),
    "zm personal recordings show example-occurrence --json",
    REMOTE_READ,
  )
  label(
    resumable(
      runsLong(recordings.command("download"))
        .description("stream recording assets into a verified local archive")
        .argument("<meeting>", "meeting id or occurrence UUID")
        .requiredOption("--output-dir <dir>", "explicit archive directory")
        .option("--file-ids <ids>", "comma-separated recording file ids")
        .option("--max-bytes <bytes>", "per-file download byte limit (default 20 GiB)", positive),
    ).action(
      async (id: string, options: { outputDir: string; fileIds?: string; maxBytes?: number; resume?: boolean }) => {
        const request = {
          destination: options.outputDir,
          fileIds: options.fileIds?.split(",").map((one) => one.trim()),
          maxBytes: options.maxBytes,
          ...archiveScope(deps, options),
          signal: deps.signal(),
        }
        validateDownloadOptions(request)
        deps.api()
        deps.output(itemOf(await deps.recordings().download(id, request)))
      },
    ),
    "zm personal recordings download example-occurrence --output-dir ./zoom-archive --json",
    FETCH,
  )
  const archive = annotate(recordings.command("archive"), { effects: NO_EFFECTS }).description(
    "inspect archives without Zoom or a database",
  )
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
    "zm personal recordings archive transcript ./zoom-archive --uuid example-occurrence --json",
    LOCAL_READ,
  )
  label(
    archive
      .command("show")
      .description("show what a local archive holds, from its transfer records")
      .argument("<directory>", "archive folder")
      .action(async (directory: string) =>
        deps.output(
          wholeList("recordings archive inspect", await deps.archive.inspect(directory, { signal: deps.signal() })),
        ),
      ),
    "zm personal recordings archive show ./zoom-archive --json",
    LOCAL_READ,
  )
  label(
    runsLong(archive.command("check"))
      .description("check the size and checksum of every file in a local archive")
      .argument("<directory>", "archive folder")
      .action(async (directory: string) =>
        deps.output(
          wholeList("recordings archive verify", await deps.archive.verify(directory, { signal: deps.signal() })),
        ),
      ),
    "zm personal recordings archive check ./zoom-archive --json",
    LOCAL_READ,
  )
  label(
    archive
      .command("locks")
      .description("list the locks on a local archive: active, stale or another machine's")
      .argument("<directory>", "archive folder")
      .action(async (directory: string) =>
        deps.output(
          wholeList("recordings archive locks", await deps.archive.locks(directory, { signal: deps.signal() })),
        ),
      ),
    "zm personal recordings archive locks ./zoom-archive --json",
    LOCAL_READ,
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
          itemOf(
            await deps.archive.recover(directory, {
              apply: options.yes === true && !options.dryRun,
              signal: deps.signal(),
            }),
          ),
        ),
      ),
    "zm personal recordings archive recover ./zoom-archive --dry-run --json",
    LOCAL_WRITE,
  )

  const remote = annotate(program.command("remote-meetings"), { effects: NO_EFFECTS }).description(
    "upcoming Zoom meetings; stored meeting reads remain under meetings",
  )
  const remoteQuery = unfilteredQuery("zoom_remote_meeting", ZOOM_ANSWER_ENTITIES["remote-meetings list"].schema)
  label(
    withQuery(remote.command("list"), remoteQuery)
      .description("list upcoming meetings")
      .action(async (words: string[]) => {
        listQuery(typedQuery(words), remoteQuery, "remote-meetings list")
        deps.api()
        deps.output(wholeList("remote-meetings list", await deps.remoteMeetings().list({ signal: deps.signal() })))
      }),
    "zm personal remote-meetings list --json",
    REMOTE_READ,
  )
  label(
    remote
      .command("show")
      .description("show an upcoming meeting")
      .argument("<meeting>", "positive numeric Zoom meeting id")
      .action(async (id: string) => {
        deps.api()
        deps.output(itemOf(await deps.remoteMeetings().show(id, { signal: deps.signal() })))
      }),
    "zm personal remote-meetings show 123456789 --json",
    REMOTE_READ,
  )
  label(
    remote
      .command("invitation")
      .description("read invitation text")
      .argument("<meeting>", "positive numeric Zoom meeting id")
      .action(async (id: string) => {
        deps.api()
        deps.output(itemOf(await deps.remoteMeetings().invitation(id, { signal: deps.signal() })))
      }),
    "zm personal remote-meetings invitation 123456789 --json",
    REMOTE_READ,
  )
  label(
    changes(remote.command("create").description("create a Zoom meeting; asks first, --dry-run previews")).action(
      async (options: ChangeOptions & MutationOptions & { yes?: boolean }) =>
        deps.output(itemOf(await deps.remoteMeetings().create(change(options), mutation(options, deps)))),
    ),
    'zm personal remote-meetings create --title "Example planning" --start-time 2026-10-10T15:30:00Z --dry-run --json',
    REMOTE_WRITE,
  )
  label(
    changes(
      remote
        .command("update")
        .description("change a Zoom meeting; asks first, --dry-run previews")
        .argument("<meeting>", "positive numeric Zoom meeting id"),
    ).action(async (id: string, options: ChangeOptions & MutationOptions & { yes?: boolean }) =>
      deps.output(itemOf(await deps.remoteMeetings().update(id, change(options), mutation(options, deps)))),
    ),
    'zm personal remote-meetings update 123456789 --title "Example planning" --dry-run --json',
    REMOTE_WRITE,
  )
  label(
    remote
      .command("cancel")
      .description("cancel a Zoom meeting; asks first, --dry-run previews")
      .argument("<meeting>", "positive numeric Zoom meeting id")
      .option("--occurrence-id <id>", "cancel one recurring occurrence")
      .option("--yes", "cancel without asking first")
      .option("--dry-run", "preview only, including when --yes is present")
      .action(async (id: string, options: MutationOptions & { yes?: boolean }) =>
        deps.output(itemOf(await deps.remoteMeetings().cancel(id, mutation(options, deps)))),
      ),
    "zm personal remote-meetings cancel 123456789 --dry-run --json",
    REMOTE_WRITE,
  )
}
