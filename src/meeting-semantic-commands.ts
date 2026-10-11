import { annotate } from "@wirecat/cli-base/commands"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"

export interface MeetingModelOptions {
  model: string
  baseUrl?: string
  dims?: number
}
export interface MeetingSemanticOptions extends MeetingModelOptions {
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
    throw new ZoomError("validation_error", "select an explicit embedding model")
  if (options.baseUrl === undefined) {
    if (options.dims !== undefined)
      throw new ZoomError("validation_error", "dimensions require an explicit remote base URL")
    return
  }
  let url: URL
  try {
    url = new URL(options.baseUrl)
  } catch {
    throw new ZoomError("validation_error", "embedding base URL must be an HTTP or HTTPS URL")
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
    throw new ZoomError(
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
    throw new ZoomError(
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
    throw new ZoomError("validation_error", "meeting embedding generation requires valid bounded limits and cursors")
}
export const addMeetingSemanticCommands = (
  program: Command,
  deps: {
    capabilities: () => Promise<MeetingSemanticCapabilities>
    signal: () => AbortSignal | undefined
    offline: () => boolean
    output: (value: unknown) => void
    receipt: (value: unknown) => Promise<void>
  },
): void => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new ZoomError("configuration_error", "meeting command group is unavailable")
  const model = (command: Command) =>
    command
      .requiredOption("--model <id>", "explicit installed local model ID, or model served at --base-url")
      .option("--base-url <url>", "explicit remote endpoint; OpenAI uses OPENAI_API_KEY")
      .option("--dims <count>", "remote embedding vector dimensions", bytes)
  const budget = (command: Command) =>
    command
      .option("--limit <count>", "bounded batch/result count from 1 through 1000", bytes)
      .option("--max-rows <count>", "transcript cue read limit from 1 through 100000", bytes)
      .option("--max-text-bytes <count>", "aggregate transcript text read byte limit (default 4 MiB)", bytes)
  annotate(
    budget(
      model(
        meetings
          .command("semantic")
          .description("search stored meeting vectors with an explicit query model; ranks only scanned candidates")
          .argument("<query>"),
      ),
    )
      .option("--max-chunks <count>", "embedded candidate scan bound", bytes)
      .option("--after-chunk-id <id>", "candidate scan continuation; not globally ranked result pagination", bytes)
      .action(async (query: string, options: MeetingSemanticOptions) => {
        validateMeetingSemantic(query, options)
        if (options.baseUrl !== undefined && deps.offline())
          throw new ZoomError("configuration_error", "remote embeddings require network access; remove --offline")
        const api = await deps.capabilities()
        deps.output(await api.search(query, { ...options, signal: deps.signal() }))
      }),
    {
      origin: "handwritten",
      mutates: false,
      examples: ['zm meetings semantic "example plan" --model e5-small --json'],
    },
  )
  annotate(
    budget(
      model(
        meetings
          .command("embeddings")
          .description("preview meeting vector generation; --yes explicitly rebuilds and embeds one bounded batch"),
      ),
    )
      .option("--after-transcript-id <id>", "transcript chunk rebuild continuation", bytes)
      .option("--after-hash <hash>", "missing embedding batch continuation")
      .option("--yes", "apply chunk rebuild and embedding generation; preview otherwise")
      .action(async (options: MeetingEmbeddingOptions) => {
        validateMeetingEmbeddings(options)
        if (options.baseUrl !== undefined && deps.offline())
          throw new ZoomError("configuration_error", "remote embeddings require network access; remove --offline")
        const api = await deps.capabilities()
        const result = await api.generate({ ...options, signal: deps.signal() })
        if (options.yes) await deps.receipt(result)
        else deps.output(result)
      }),
    { origin: "handwritten", mutates: true, local: true, examples: ["zm meetings embeddings --model e5-small --json"] },
  )
}
