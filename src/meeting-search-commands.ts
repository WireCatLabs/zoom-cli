import { annotate } from "@wirecat/cli-base/commands"
import { addMeetingSearchCommand, type MeetingHitSearch } from "@wirecat/cli-core/meetings/cli"
import type { Command } from "commander"
import type { ArchiveTranscriptService } from "./archive-commands.js"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"
import { type MeetingSemanticCapabilities, validateMeetingSemantic } from "./meeting-semantic-commands.js"

export {
  type MeetingHitSearch,
  type MeetingHitSearchOptions,
  validateMeetingHitSearch,
} from "@wirecat/cli-core/meetings/cli"

interface SearchOptions {
  meetingId?: number
  identityId?: number
  personId?: number
  eventId?: number
  seriesId?: number
  project?: string
  tag?: string
  topic?: string
  sinceTime?: number
  untilTime?: number
  limit?: number
  cursor?: string
  maxReadBytes?: number
  model?: string
  baseUrl?: string
  dims?: number
  maxChunks?: number
  maxRows?: number
  maxTextBytes?: number
  archive?: string
  uuid?: string
  fileIds?: string
  maxBytes?: number
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
  uuid: "--uuid",
  fileIds: "--file-ids",
  maxBytes: "--max-bytes",
} satisfies Partial<Record<keyof SearchOptions, string>>
const refuse = (options: SearchOptions, keys: readonly (keyof typeof FLAG)[], mode: string) => {
  const given = keys.filter((key) => options[key] !== undefined).map((key) => FLAG[key])
  if (given.length) throw new ZoomError("validation_error", `${given.join(", ")} do not apply ${mode}`)
}
const chunkCursor = (cursor: string | undefined): number | undefined => {
  if (cursor === undefined) return undefined
  if (!/^[1-9]\d*$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
    throw new ZoomError("validation_error", "--cursor by meaning takes the previous page's next_cursor")
  return Number(cursor)
}

/** One meeting search: stored words by default, meaning with --model, an archive folder with --archive. */
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
  const command = addMeetingSearchCommand(program, {
    signal: deps.signal,
    output: deps.output,
    search: async (query, request, raw) => {
      const options = raw as SearchOptions
      if (options.archive !== undefined) {
        refuse(
          options,
          [
            ...STORE_FILTERS,
            "cursor",
            "maxReadBytes",
            "model",
            "baseUrl",
            "dims",
            "maxChunks",
            "maxRows",
            "maxTextBytes",
          ],
          "to an archive folder",
        )
        return deps.archive(options.archive, query, {
          uuid: options.uuid,
          fileIds: options.fileIds?.split(",").map((id) => id.trim()),
          maxBytes: options.maxBytes,
          limit: options.limit,
          signal: deps.signal(),
        })
      }
      refuse(options, ["uuid", "fileIds", "maxBytes"], "without --archive")
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
          throw new ZoomError("configuration_error", "remote embeddings require network access; remove --offline")
        const found = (await (await deps.meaning()).search(query, meaning)) as { nextChunkId?: number }
        return { ...found, nextCursor: found.nextChunkId === undefined ? null : String(found.nextChunkId) }
      }
      refuse(options, ["baseUrl", "dims", "maxChunks", "maxRows", "maxTextBytes"], "without --model")
      return (await deps.words())(query, request)
    },
  })
  command
    .description("find words in stored meetings, by meaning with --model, or in an archive folder")
    .option("--model <model>", "search by meaning with this embedding model, building missing vectors first")
    .option("--base-url <url>", "remote embedding service for --model; OpenAI reads OPENAI_API_KEY")
    .option("--dims <n>", "vector size the remote service returns, in dimensions", bytes)
    .option("--max-chunks <n>", "by meaning: most stored passages to compare", bytes)
    .option("--max-rows <n>", "by meaning: most transcript lines to read, 1 through 100000", bytes)
    .option("--max-text-bytes <bytes>", "by meaning: most transcript text to read (default 4 MiB)", bytes)
    .option("--archive <directory>", "search the transcripts of this archive folder, before any import")
    .option("--uuid <uuid>", "with --archive: only this occurrence UUID")
    .option("--file-ids <ids>", "with --archive: only these comma-separated transcript asset ids")
    .option("--max-bytes <bytes>", "with --archive: largest transcript file to read (default 8 MiB)", bytes)
  annotate(command, {
    origin: "handwritten",
    mutates: false,
    examples: [
      'zm search meetings "example plan" --since-time 2026-09-01 --json',
      'zm search meetings "example plan" --model e5-small --json',
      'zm search meetings "example plan" --archive ./zoom-archive --offline --json',
    ],
  })
}
