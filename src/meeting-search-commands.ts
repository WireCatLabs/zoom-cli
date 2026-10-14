import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { LOCAL_READ } from "@wirecat/cli-core/cli"
import { meetingHitsList } from "@wirecat/cli-core/meetings"
import {
  createMeetingSearchCommand,
  type MeetingHitSearch,
  type MeetingHitSearchOptions,
  type MeetingSearchFlags,
  meetingHitSearchRequest,
  meetingSearchArguments,
} from "@wirecat/cli-core/meetings/cli"
import type { Command } from "commander"
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
const STORE_FILTERS = [
  "meetingId",
  "identityId",
  "personId",
  "eventId",
  "seriesId",
  "project",
  "tag",
  "topic",
  "sinceTime",
  "untilTime",
] as const
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
const chunkCursor = (cursor: string | undefined): number | undefined => {
  if (cursor === undefined) return undefined
  if (!/^[1-9]\d*$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
    throw new CliError("validation_error", "--cursor by meaning takes the previous page's next_cursor")
  return Number(cursor)
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

/** One meeting search: stored words by default, meaning with --model. */
export const addMeetingSearchCommands = (
  program: Command,
  deps: {
    words: () => Promise<MeetingHitSearch>
    meaning: () => Promise<MeetingSemanticCapabilities>
    archive: ArchiveTranscriptService["search"]
    offline: () => boolean
    signal: () => AbortSignal | undefined
    output: (value: unknown) => void
  },
): void => {
  const execute = async (query: string, request: MeetingHitSearchOptions, options: SearchOptions) => {
    if (options.model !== undefined) {
      refuse(options, [...STORE_FILTERS, "maxReadBytes"], "to a search by meaning")
      const meaning = {
        model: options.model,
        baseUrl: options.baseUrl,
        dims: options.dims,
        limit: options.limit,
        maxChunks: options.maxChunks,
        afterChunkId: chunkCursor(options.cursor),
        maxRows: options.maxRows,
        maxTextBytes: options.maxTextBytes,
        buildMissing: true,
        signal: deps.signal(),
      }
      validateMeetingSemantic(query, meaning)
      if (meaning.baseUrl !== undefined && deps.offline())
        throw new CliError("configuration_error", "remote embeddings require network access; remove --offline")
      const found = (await (await deps.meaning()).search(query, meaning)) as { nextChunkId?: number }
      return { ...found, nextCursor: found.nextChunkId === undefined ? null : String(found.nextChunkId) }
    }
    refuse(options, ["baseUrl", "dims", "maxChunks", "maxRows", "maxTextBytes"], "without --model")
    return meetingHitsList(
      await (await deps.words())(query, request),
      request.limit ?? 100,
      "search meetings",
      meetingSearchArguments(query, options),
    )
  }
  const command = createMeetingSearchCommand(program).action(async (query: string, options: SearchOptions) => {
    const request = meetingHitSearchRequest(query, options, deps.signal())
    deps.output(await execute(query, request, options))
  })
  command
    .description("find words in stored meetings, or by meaning with --model")
    .option("--model <model>", "search by meaning with this embedding model, building missing vectors first")
    .option("--base-url <url>", "remote embedding service for --model; OpenAI reads OPENAI_API_KEY")
    .option("--dims <n>", "vector size the remote service returns, in dimensions", bytes)
    .option("--max-chunks <n>", "by meaning: most stored passages to compare", bytes)
    .option("--max-rows <n>", "by meaning: most transcript lines to read, 1 through 100000", bytes)
    .option("--max-text-bytes <bytes>", "by meaning: most transcript text to read (default 4 MiB)", bytes)
  annotate(command, {
    origin: "handwritten",
    effects: LOCAL_READ,
    examples: [
      'zm search meetings "example plan" --since-time 2026-09-01 --json',
      'zm search meetings "example plan" --model e5-small --json',
    ],
  })
  const search = program.commands.find((child) => child.name() === "search") ?? program.command("search")
  const recordings = search
    .command("recordings")
    .description("find words in the transcripts of a downloaded archive folder, before any import")
    .argument("<directory>", "archive folder")
    .argument("<query...>", "words to find as one phrase, ignoring case")
    .option("--limit <n>", "how many hits, 1 through 1000 (default 100)", bytes)
    .action(async (directory: string, words: string[], options: { limit?: number }) => {
      const found = await deps.archive(directory, words.join(" "), { limit: options.limit, signal: deps.signal() })
      deps.output({ ...found, items: found.items.map(recordingHit(directory)) })
    })
  annotate(recordings, {
    origin: "handwritten",
    effects: LOCAL_READ,
    output: { entity: "hit" },
    examples: ['zm search recordings ./zoom-archive "example plan" --limit 100 --offline --json'],
  })
}
