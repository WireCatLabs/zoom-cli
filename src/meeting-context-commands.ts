import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, itemOf, LOCAL_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { bodyOf } from "./answer-output.js"
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
    output: (body: Body) => void
  },
) => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new CliError("configuration_error", "meeting command group is unavailable")
  const label = (command: Command, example: string, entity?: string) =>
    annotate(command, {
      origin: "handwritten",
      effects: LOCAL_READ,
      examples: [example],
      ...(entity ? { output: { entity } } : {}),
    })
  const limits = (command: Command) =>
    command
      .option("--cues <n>", "how many transcript lines, 1 through 1000", bytes)
      .option("--bytes <bytes>", "how much text, in bytes, 2 through 4194304", bytes)
  label(
    limits(
      meetings
        .command("evidence")
        .description("read the stored transcript lines, chat or summary behind a meeting reference")
        .argument("<reference>", "meeting reference, such as meeting:3/15"),
    )
      .option("--cursor <cursor>", "continue after this line reference from the previous page")
      .option("--after-transcript-id <id>", "resume root-reference revision scan, including empty revisions", bytes)
      .option("--max-read-bytes <bytes>", "most stored bytes to read per page (default 4 MiB)", bytes)
      .option("--max-transcript-pages <n>", "most transcript pages to read, 1 through 1000", bytes)
      .action(async (reference: string, { cursor, ...rest }: Omit<EvidenceOptions, "after"> & { cursor?: string }) => {
        const options: EvidenceOptions = { ...rest, after: cursor }
        validateEvidenceOptions(options)
        const context = await deps.context()
        deps.output(
          bodyOf(
            await context.evidence(reference, {
              cues: options.cues,
              bytes: options.bytes,
              after: options.after,
              afterTranscriptId: options.afterTranscriptId,
              maxReadBytes: options.maxReadBytes,
              maxTranscriptPages: options.maxTranscriptPages,
              signal: deps.signal(),
            }),
          ),
        )
      }),
    "zm meetings evidence meeting:3/15 --json",
  )
  label(
    limits(
      meetings
        .command("context")
        .description("what the stored meetings say about a person, through linked identities")
        .argument("<person>", "stored person, such as person:7"),
    )
      .option("--meetings <n>", "how many meetings, 1 through 100", bytes)
      .option("--scan-limit <n>", "most identity links to look at, 1 through 1000", bytes)
      .option("--since-time <time>", "only identity links since this ISO 8601 time", (value: string) => {
        const stamp = Date.parse(value)
        if (!Number.isSafeInteger(stamp) || new Date(stamp).toISOString() !== value)
          throw new CliError("validation_error", "--since-time must be a canonical ISO 8601 time")
        return stamp
      })
      .action(
        async (
          person: string,
          { sinceTime, ...rest }: Omit<PersonContextOptions, "since"> & { sinceTime?: number },
        ) => {
          const options: PersonContextOptions = { ...rest, since: sinceTime }
          validatePersonContext(person, options)
          const context = await deps.context()
          deps.output(
            bodyOf(
              await context.personContext(person, {
                meetings: options.meetings,
                cues: options.cues,
                bytes: options.bytes,
                scanLimit: options.scanLimit,
                since: options.since,
                signal: deps.signal(),
              }),
            ),
          )
        },
      ),
    "zm meetings context person:7 --meetings 10 --json",
  )
  label(
    meetings
      .command("task-proposal")
      .description("preview the task a meeting line would become, without creating it")
      .argument("<reference>", "transcript line reference, such as meeting:3/15/20/0")
      .requiredOption("--type <type>", "question, request, mention or promise")
      .action(async (reference: string, options: { type: string }) => {
        const kind = validateTaskKind(options.type)
        const context = await deps.context()
        const proposal = await context.taskProposal(reference, kind, deps.signal())
        validateTaskProposal(proposal)
        deps.output(itemOf(proposal))
      }),
    "zm meetings task-proposal meeting:3/15/20/0 --type promise --json",
    "meeting_task_proposal",
  )
}
