import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, FETCH, itemOf } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { bytes } from "./execution.js"

export interface MeetingModelOptions {
  model: string
  baseUrl?: string
  dims?: number
}
export interface MeetingSemanticOptions extends MeetingModelOptions {
  /** Split new transcripts and embed passages that have no vector first; MCP reads never write. */
  buildMissing?: boolean
  limit?: number
  maxChunks?: number
  afterChunkId?: number
  maxRows?: number
  maxTextBytes?: number
  signal?: AbortSignal
}
export interface MeetingEmbeddingOptions extends MeetingModelOptions {
  limit?: number
  afterTranscriptId?: number
  afterHash?: string
  maxRows?: number
  maxTextBytes?: number
  yes?: boolean
  signal?: AbortSignal
}
export interface MeetingSemanticCapabilities {
  search: (query: string, options: MeetingSemanticOptions) => Promise<unknown>
  generate: (options: MeetingEmbeddingOptions) => Promise<unknown>
}
const bounded = (value: number | undefined, maximum: number) =>
  value === undefined || (Number.isSafeInteger(value) && value > 0 && value <= maximum)
export const validateMeetingModel = (options: MeetingModelOptions): void => {
  if (typeof options.model !== "string" || !options.model.trim() || options.model.length > 1000)
    throw new CliError("validation_error", "select an explicit embedding model")
  if (options.baseUrl === undefined) {
    if (options.dims !== undefined)
      throw new CliError("validation_error", "dimensions require an explicit remote base URL")
    return
  }
  let url: URL
  try {
    url = new URL(options.baseUrl)
  } catch {
    throw new CliError("validation_error", "embedding base URL must be an HTTP or HTTPS URL")
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[\w./:-]{1,200}$/.test(options.model) ||
    options.dims === undefined ||
    !bounded(options.dims, 8192)
  )
    throw new CliError(
      "validation_error",
      "remote embeddings require an HTTP base URL without credentials and explicit dimensions",
    )
}
export const validateMeetingSemantic = (query: string, options: MeetingSemanticOptions): void => {
  validateMeetingModel(options)
  if (
    typeof query !== "string" ||
    !query.trim() ||
    Buffer.byteLength(query, "utf8") > 65536 ||
    !bounded(options.limit, 1000) ||
    !bounded(options.maxChunks, 10000) ||
    !bounded(options.afterChunkId, Number.MAX_SAFE_INTEGER) ||
    !bounded(options.maxRows, 100000) ||
    !bounded(options.maxTextBytes, 64 * 1024 * 1024)
  )
    throw new CliError(
      "validation_error",
      "meeting semantic search requires a nonempty bounded query and positive limits",
    )
}
export const validateMeetingEmbeddings = (options: MeetingEmbeddingOptions): void => {
  validateMeetingModel(options)
  if (
    !bounded(options.limit, 1000) ||
    !bounded(options.afterTranscriptId, Number.MAX_SAFE_INTEGER) ||
    !bounded(options.maxRows, 100000) ||
    !bounded(options.maxTextBytes, 64 * 1024 * 1024) ||
    (options.afterHash !== undefined && !/^[a-f0-9]{64}$/.test(options.afterHash))
  )
    throw new CliError("validation_error", "meeting embedding generation requires valid bounded limits and cursors")
}
export const addMeetingEmbeddingCommand = (
  program: Command,
  deps: {
    capabilities: () => Promise<MeetingSemanticCapabilities>
    signal: () => AbortSignal | undefined
    offline: () => boolean
    output: (body: Body) => void
    receipt: (body: Body) => Promise<void>
  },
): void => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new CliError("configuration_error", "meeting command group is unavailable")
  const model = (command: Command) =>
    command
      .requiredOption("--model <model>", "embedding model: an installed local one, or one served at --base-url")
      .option("--base-url <url>", "remote embedding service; OpenAI reads OPENAI_API_KEY")
      .option("--dims <n>", "vector size the remote service returns, in dimensions", bytes)
  const budget = (command: Command) =>
    command
      .option("--limit <n>", "how many results or items in one batch, 1 through 1000", bytes)
      .option("--max-rows <n>", "most transcript lines to read, 1 through 100000", bytes)
      .option("--max-text-bytes <bytes>", "most transcript text to read, in bytes (default 4 MiB)", bytes)
  annotate(
    budget(
      model(meetings.command("embeddings").description("preview building meeting vectors; --yes builds one batch")),
    )
      .option("--after-transcript-id <id>", "continue splitting transcripts after this one", bytes)
      .option("--after-hash <hash>", "continue embedding after this passage")
      .option("--yes", "split transcripts and build their vectors; otherwise only preview")
      .action(async (options: MeetingEmbeddingOptions) => {
        validateMeetingEmbeddings(options)
        if (options.baseUrl !== undefined && deps.offline())
          throw new CliError("configuration_error", "remote embeddings require network access; remove --offline")
        const api = await deps.capabilities()
        const result = await api.generate({ ...options, signal: deps.signal() })
        if (options.yes) await deps.receipt(itemOf(result))
        else deps.output(itemOf(result))
      }),
    { origin: "handwritten", effects: FETCH, examples: ["zm meetings embeddings --model e5-small --json"] },
  )
}
