import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, FETCH, LOCAL_READ, listOf, NO_EFFECTS } from "@wirecat/cli-core/cli"
import { meetingHitsList } from "@wirecat/cli-core/meetings"
import {
  createMeetingSearchCommand,
  type MeetingHitSearch,
  type MeetingSearchFlags,
  meetingHitSearchRequest,
  meetingSearchArguments,
  meetingSearchMeta,
} from "@wirecat/cli-core/meetings/cli"
import { Command } from "commander"
import type { ArchiveTranscriptService } from "./archive-commands.js"
import type { ArchiveTranscriptMatch } from "./archive-transcripts.js"
import { bytes } from "./execution.js"
import { type MeetingSemanticCapabilities, validateMeetingSemantic } from "./meeting-semantic-commands.js"

export {
  type MeetingHitSearch,
  type MeetingHitSearchOptions,
  validateMeetingHitSearch,
} from "@wirecat/cli-core/meetings/cli"

interface SearchOptions extends MeetingSearchFlags {
  model?: string
  baseUrl?: string
  dims?: number
  maxChunks?: number
  maxRows?: number
  maxTextBytes?: number
}
const FLAG = {
  meetingId: "--meeting-id",
  identityId: "--identity-id",
  personId: "--person-id",
  eventId: "--event-id",
  seriesId: "--series-id",
  project: "--project",
  tag: "--tag",
  topic: "--topic",
  sinceTime: "--since-time",
  untilTime: "--until-time",
  cursor: "--cursor",
  maxReadBytes: "--max-read-bytes",
  model: "--model",
  baseUrl: "--base-url",
  dims: "--dims",
  maxChunks: "--max-chunks",
  maxRows: "--max-rows",
  maxTextBytes: "--max-text-bytes",
} satisfies Partial<Record<keyof SearchOptions, string>>
const refuse = (options: SearchOptions, keys: readonly (keyof typeof FLAG)[], mode: string) => {
  const given = keys.filter((key) => options[key] !== undefined).map((key) => FLAG[key])
  if (given.length) throw new CliError("validation_error", `${given.join(", ")} do not apply ${mode}`)
}

/** An archive cue as a `search all` hit: an archive has no store ids, so the ref names the asset and cue. */
const recordingHit = (directory: string) => (match: ArchiveTranscriptMatch) => {
  const meetingStart = Date.parse(match.meeting.startedAt ?? "")
  const assetStart = Date.parse(match.asset.startedAt ?? "")
  const lead = assetStart - meetingStart
  return {
    kind: "meeting",
    ref: `recording:${match.asset.id}/${match.position}`,
    provider: "zoom",
    account: directory,
    title: match.meeting.title,
    timestamp: Number.isFinite(meetingStart) ? new Date(meetingStart).toISOString() : null,
    excerpt: match.text,
    sender_name: match.speaker,
    offset_ms: match.startMs + (Number.isFinite(lead) && lead > 0 ? lead : 0),
  }
}

type CombinedPage = Awaited<ReturnType<typeof import("@wirecat/cli-core/services").searchMeetingsCombined>>

/** Combined hits as the list answer: each cites a line, says how it was found, and keeps its passage. */
const combinedList = (found: CombinedPage, limit: number, args: Record<string, unknown>): Body =>
  listOf("search meetings", {
    items: found.items.map((hit) => ({
      ref: hit.ref,
      meeting: hit.ref.split("/").slice(0, 2).join("/"),
      scope: hit.scope,
      excerpt: hit.text,
      offset_ms: hit.startMs,
      by: hit.by,
      score: hit.score,
      ...(hit.passage ? { passage: hit.passage } : {}),
      ...(hit.match ? { match: hit.match } : {}),
      ...(hit.corrections ? { corrections: hit.corrections } : {}),
      source: {
        title: hit.source.title,
        started_at: hit.source.startedAt === null ? null : new Date(hit.source.startedAt).toISOString(),
        url: hit.source.url,
      },
    })),
    limit,
    has_more: found.hasMore,
    paging: "cursor",
    ...(found.nextCursor ? { cursor: found.nextCursor } : {}),
    args,
    missing: [
      ...(found.coverage.meaningScanComplete
        ? []
        : [{ field: "items", why: `meaning compared only ${found.coverage.scanned} passages; raise --max-chunks` }]),
      ...(found.words.refused ? [{ field: "items", why: `found by meaning only: ${found.words.refused}` }] : []),
    ],
  }) as Body

/** zm's options beside the shared ones: by meaning, and the bounds of a search by meaning. */
const withMeaningOptions = (command: Command): Command =>
  command
    .description("find words in stored meetings, or by meaning with --model")
    .option(
      "--model <model>",
      "rank words and meaning together with this embedding model, building missing vectors first",
    )
    .option("--base-url <url>", "remote embedding service for --model; OpenAI reads OPENAI_API_KEY")
    .option("--dims <n>", "vector size the remote service returns, in dimensions", bytes)
    .option("--max-chunks <n>", "by meaning: most stored passages to compare (default 10000)", bytes)
    .option("--max-rows <n>", "by meaning: most transcript lines to read, 1 through 100000", bytes)
    .option("--max-text-bytes <bytes>", "by meaning: most transcript text to read (default 4 MiB)", bytes)

/** A fresh `search meetings` to read saved options with: the same flags, parsers and checks as the real one. */
export const meetingSearchDefinition = (): { program: Command; command: Command } => {
  const program = new Command()
  const command = withMeaningOptions(createMeetingSearchCommand(program))
  return { program, command }
}

export type MeetingSearchRun = (query: string, options: SearchOptions) => Promise<Body>

/** One meeting search: stored words by default, words and meaning ranked together with --model. */
export const addMeetingSearchCommands = (
  program: Command,
  deps: {
    words: () => Promise<MeetingHitSearch>
    meaning: () => Promise<MeetingSemanticCapabilities>
    archive: ArchiveTranscriptService["search"]
    offline: () => boolean
    signal: () => AbortSignal | undefined
    output: (body: Body) => void
  },
): MeetingSearchRun => {
  const execute = async (query: string, options: SearchOptions): Promise<Body> => {
    const request = meetingHitSearchRequest(query, options, deps.signal())
    if (options.model !== undefined) {
      refuse(options, ["maxReadBytes"], "to a search by meaning")
      const { limit, after, maxReadBytes: _bytes, signal, ...selection } = request
      const meaning = {
        model: options.model,
        baseUrl: options.baseUrl,
        dims: options.dims,
        limit: limit ?? 20,
        maxChunks: options.maxChunks,
        after,
        selection,
        maxRows: options.maxRows,
        maxTextBytes: options.maxTextBytes,
        buildMissing: true,
        signal,
      }
      validateMeetingSemantic(query, meaning)
      if (meaning.baseUrl !== undefined && deps.offline())
        throw new CliError("configuration_error", "remote embeddings require network access; remove --offline")
      return combinedList(
        (await (await deps.meaning()).search(query, meaning)) as CombinedPage,
        meaning.limit,
        meetingSearchArguments(query, options),
      )
    }
    refuse(options, ["baseUrl", "dims", "maxChunks", "maxRows", "maxTextBytes"], "without --model")
    return meetingHitsList(
      await (await deps.words())(query, request),
      request.limit ?? 100,
      "search meetings",
      meetingSearchArguments(query, options),
      meetingSearchMeta(options),
    )
  }
  const command = withMeaningOptions(createMeetingSearchCommand(program)).action(
    async (query: string, options: SearchOptions) => {
      deps.output(await execute(query, options))
    },
  )
  annotate(command, {
    origin: "handwritten",
    effects: FETCH,
    examples: [
      'zm search meetings "example plan" --since-time 2026-09-01 --json',
      'zm search meetings "example plan" --model e5-small --json',
    ],
  })
  const search =
    program.commands.find((child) => child.name() === "search") ??
    annotate(program.command("search"), { effects: NO_EFFECTS })
  const recordings = search
    .command("recordings")
    .description("find words in the transcripts of a downloaded archive folder, before any import")
    .argument("<directory>", "archive folder")
    .argument("<query...>", "words to find as one phrase, ignoring case")
    .option("--limit <n>", "how many hits, 1 through 1000 (default 100)", bytes)
    .action(async (directory: string, words: string[], options: { limit?: number }) => {
      const found = await deps.archive(directory, words.join(" "), { limit: options.limit, signal: deps.signal() })
      deps.output({
        items: found.items.map(recordingHit(directory)),
        page: { mode: "page", limit: found.limit, has_more: found.hasMore },
      })
    })
  annotate(recordings, {
    origin: "handwritten",
    effects: LOCAL_READ,
    output: { entity: "hit" },
    examples: ['zm search recordings ./zoom-archive "example plan" --limit 100 --offline --json'],
  })
  return execute
}
