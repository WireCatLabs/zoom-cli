import { annotate } from "@wirecat/cli-base/commands"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { bytes } from "./execution.js"
import {
  type EvidenceOptions,
  type MeetingContextCapabilities,
  type PersonContextOptions,
  validateEvidenceOptions,
  validatePersonContext,
  validateTaskKind,
  validateTaskProposal,
} from "./meeting-context.js"

export const addMeetingContextCommands = (
  program: Command,
  deps: {
    context: () => Promise<MeetingContextCapabilities>
    signal: () => AbortSignal | undefined
    output: (value: unknown) => void
  },
) => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new ZoomError("configuration_error", "meeting command group is unavailable")
  const label = (command: Command, example: string) =>
    annotate(command, { origin: "handwritten", mutates: false, examples: [example] })
  const limits = (command: Command) =>
    command
      .option("--cues <count>", "cue limit from 1 through 1000", bytes)
      .option("--bytes <count>", "content byte limit from 2 through 4194304", bytes)
  label(
    limits(
      meetings
        .command("evidence")
        .description("read bounded stored evidence from a selected-account meeting reference")
        .argument("<reference>"),
    )
      .option("--after <reference>", "resume after a cue reference from the same source")
      .option("--after-transcript-id <id>", "resume root-reference revision scan, including empty revisions", bytes)
      .option("--max-read-bytes <count>", "SQL input byte budget per page (default 4 MiB)", bytes)
      .option("--max-transcript-pages <count>", "transcript page work budget from 1 through 1000", bytes)
      .action(async (reference: string, options: EvidenceOptions) => {
        validateEvidenceOptions(options)
        const context = await deps.context()
        if (!context.evidence) throw new ZoomError("configuration_error", "meeting evidence capability is unavailable")
        deps.output(
          await context.evidence(reference, {
            cues: options.cues,
            bytes: options.bytes,
            after: options.after,
            afterTranscriptId: options.afterTranscriptId,
            maxReadBytes: options.maxReadBytes,
            maxTranscriptPages: options.maxTranscriptPages,
            signal: deps.signal(),
          }),
        )
      }),
    "zm meetings evidence meeting:3/15 --json",
  )
  label(
    limits(
      meetings
        .command("context")
        .description("identity-linked person context restricted to the selected account; completeness is explicit")
        .argument("<person>"),
    )
      .option("--meetings <count>", "meeting limit from 1 through 100", bytes)
      .option("--scan-limit <count>", "identity-link candidate bound from 1 through 1000", bytes)
      .option("--since <iso>", "read identity links since this ISO instant", (value: string) => {
        const stamp = Date.parse(value)
        if (!Number.isSafeInteger(stamp) || new Date(stamp).toISOString() !== value)
          throw new ZoomError("validation_error", "since must be a canonical ISO timestamp")
        return stamp
      })
      .action(async (person: string, options: PersonContextOptions) => {
        validatePersonContext(person, options)
        const context = await deps.context()
        if (!context.personContext)
          throw new ZoomError("configuration_error", "person meeting context capability is unavailable")
        deps.output(
          await context.personContext(person, {
            meetings: options.meetings,
            cues: options.cues,
            bytes: options.bytes,
            scanLimit: options.scanLimit,
            since: options.since,
            signal: deps.signal(),
          }),
        )
      }),
    "zm meetings context person:7 --meetings 10 --json",
  )
  label(
    meetings
      .command("task-proposal")
      .description("preview a provenance-linked task proposal without creating a task")
      .argument("<reference>")
      .requiredOption("--kind <kind>", "question, request, mention or promise")
      .action(async (reference: string, options: { kind: string }) => {
        const kind = validateTaskKind(options.kind)
        const context = await deps.context()
        if (!context.taskProposal)
          throw new ZoomError("configuration_error", "meeting task proposal capability is unavailable")
        const proposal = await context.taskProposal(reference, kind, deps.signal())
        validateTaskProposal(proposal)
        deps.output(proposal)
      }),
    "zm meetings task-proposal meeting:3/15/20/0 --kind promise --json",
  )
}
