import { CliError } from "@wirecat/cli-base"
import {
  addMeetingBatchCommand,
  addMeetingProjectCandidatesCommand,
  type Body,
  formatMeetingBatch,
} from "@wirecat/cli-core/cli"
import type { MeetingBatchReader } from "@wirecat/cli-core/meetings"
import { addMeetingPassageCommand } from "@wirecat/cli-core/meetings/cli"
import type { Command } from "commander"
import { type AnswerFormat, bodyOf } from "./answer-output.js"
import { applyArchiveImport, preflightArchiveImport } from "./archive-import.js"
import { searchArchiveTranscripts } from "./archive-transcripts.js"
import type { ExecutionState } from "./execution.js"
import { addIngestionSearchCommands } from "./ingestion-search-commands.js"
import { addLocalTranscriptionCommands } from "./local-transcription-commands.js"
import type { ContextCapture } from "./meeting-communications-binding.js"
import { addMeetingContextCommands } from "./meeting-context-commands.js"
import { addMeetingIntegrationCommands } from "./meeting-integration-commands.js"
import type { ZoomPreparationOptions } from "./meeting-preparation.js"
import { createZoomProjectCandidateReader } from "./meeting-project-candidates.js"
import { addMeetingReadBindings } from "./meeting-read-command-bindings.js"
import { addMeetingSearchCommands } from "./meeting-search-commands.js"
import { addMeetingEmbeddingCommand } from "./meeting-semantic-commands.js"
import { addMeetingStatsCommands } from "./meeting-stats-commands.js"
import type { ProgramDeps } from "./program.js"
import type { StoreConnection, StoreConnectRequest } from "./store-connection.js"
import { runUnifiedSearch } from "./unified-search.js"

export interface StoreCommandContext {
  deps: Pick<ProgramDeps, "now" | "archiveTranscripts" | "readBatchInput">
  /** The one connection a command run shares; opened on first use. */
  connected: (intent?: StoreConnectRequest["intent"]) => Promise<StoreConnection>
  /** A connection of its own, which the caller closes. */
  openStore: (intent: StoreConnectRequest["intent"], context?: ContextCapture) => Promise<StoreConnection>
  preparation: ZoomPreparationOptions
  signal: () => AbortSignal | undefined
  output: (body: Body) => void
  outputItems: (values: AsyncIterable<unknown>) => Promise<void>
  receipt: (body: Body) => Promise<void>
  buffer: (text: string) => void
  rendered: (body: Body, format?: AnswerFormat, selectFields?: boolean) => string
  fields: () => string[] | undefined
  meta: ExecutionState["meta"]
}

/** Zoom's commands over the shared meeting store, each opening it only when its action runs. */
export const addStoreCommands = (program: Command, context: StoreCommandContext): void => {
  const {
    deps,
    connected,
    openStore,
    preparation,
    signal,
    output,
    outputItems,
    receipt,
    buffer,
    rendered,
    fields,
    meta,
  } = context
  addIngestionSearchCommands(program, {
    signal,
    output,
    outputItems,
    receipt,
    preflight: preflightArchiveImport,
    apply: async function* (plan) {
      if (plan.occurrences === 0) return
      const connection = await connected("ingestion")
      for await (const item of applyArchiveImport(plan, connection, {
        accountId: connection.accountId,
        now: deps.now?.(),
        signal: signal(),
      }))
        yield item
    },
    search: async (request) => runUnifiedSearch((await connected()).unifiedSearch, request),
  })
  addMeetingReadBindings(program, {
    project: {
      read: async (project, request) => (await connected()).meetingProjectEvidence(project, request),
      signal,
      now: deps.now,
      output: (value) => output(bodyOf(value)),
    },
    preparation: {
      ...preparation,
      connect: (context) => openStore("preparation", context),
    },
  })
  addMeetingProjectCandidatesCommand(program, {
    read: createZoomProjectCandidateReader(() => openStore("preparation")),
    signal,
    output: (value) => output(bodyOf(value)),
  })
  addMeetingIntegrationCommands(program, {
    signal,
    output,
    receipt,
    integration: async () => (await connected()).meetingIntegration,
  })
  addLocalTranscriptionCommands(program, {
    signal,
    output,
    receipt,
    capabilities: async () => (await connected()).meetingTranscription,
  })
  const meetingContext = async () => (await connected()).meetingContext
  addMeetingContextCommands(program, {
    signal,
    output,
    context: meetingContext,
  })
  addMeetingPassageCommand(program, {
    signal,
    read: async (reference, options) => {
      if (fields() && options.format !== "json")
        throw new CliError("validation_error", "passage field selection requires --json or --format json")
      return (await meetingContext()).passage(reference, options)
    },
    output: (result, format) => {
      if (format === "json") buffer(rendered(bodyOf(result.packet), program.opts().jsonl ? "jsonl" : "json"))
      else buffer(result.content)
    },
  })
  const meetingSemantic = async () => (await connected()).meetingSemantic
  addMeetingStatsCommands(program, {
    signal,
    output,
    read: async () => {
      const read = (await connected()).meetingStats
      if (!read) throw new CliError("configuration_error", "the selected store connector does not count meetings")
      return read
    },
  })
  addMeetingSearchCommands(program, {
    signal,
    offline: () => Boolean(program.opts().offline),
    output,
    words: async () => (await connected()).meetingSearch,
    meaning: meetingSemantic,
    archive: (deps.archiveTranscripts ?? { search: searchArchiveTranscripts }).search,
  })
  addMeetingEmbeddingCommand(program, {
    signal,
    offline: () => Boolean(program.opts().offline),
    receipt,
    output,
    capabilities: meetingSemantic,
  })
  const batchReader = async (): Promise<MeetingBatchReader> => {
    const reader = (await connected()).meetingBatch
    if (!reader)
      throw new CliError("configuration_error", "the selected store connector does not support meeting batches")
    return reader
  }
  addMeetingBatchCommand(program, {
    signal,
    fields,
    meta,
    input: async (path, signal) => {
      if (!deps.readBatchInput) throw new CliError("configuration_error", "batch input reader is unavailable")
      return deps.readBatchInput(path, signal)
    },
    reader: {
      index: async (options) => (await batchReader()).index(options),
      search: async (query, options) => (await batchReader()).search(query, options),
      passage: async (reference, options) => (await batchReader()).passage(reference, options),
    },
    output: (body, report, format) => {
      const text =
        format === "json"
          ? rendered(body, program.opts().jsonl ? "jsonl" : "json", false)
          : formatMeetingBatch(report, format)
      if (Buffer.byteLength(text, "utf8") > 4194304)
        throw new CliError("invalid_response", "batch rendered output exceeds 4194304 bytes", {
          reason: "output.too-large",
          max_bytes: 4194304,
        })
      buffer(text)
    },
  })
}
