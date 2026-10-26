import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, itemOf, LOCAL_READ, LOCAL_WRITE } from "@wirecat/cli-core/cli"
import { validateMeetingContextChange } from "@wirecat/cli-core/meetings"
import type { Command } from "commander"
import { bytes } from "./execution.js"
import {
  integrationReference,
  type MeetingIntegrationCapabilities,
  type MeetingLinkChange,
} from "./meeting-integration.js"

export const addMeetingIntegrationCommands = (
  program: Command,
  deps: {
    integration: () => Promise<MeetingIntegrationCapabilities>
    signal: () => AbortSignal | undefined
    output: (body: Body) => void
    receipt: (body: Body) => Promise<void>
  },
) => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new CliError("configuration_error", "meeting command group is unavailable")
  const label = (command: Command, example: string, mutates = false) =>
    annotate(command, {
      origin: "handwritten",
      effects: mutates ? LOCAL_WRITE : LOCAL_READ,
      examples: [example],
    })
  const guards = (command: Command) =>
    command.option("--yes", "apply this local change once").option("--dry-run", "preview even when --yes is present")
  const apply = async (reference: string, input: MeetingLinkChange, options: { yes?: boolean; dryRun?: boolean }) => {
    const target = integrationReference(reference)
    const change = validateMeetingContextChange(input)
    if (change.action !== "event.link" && change.action !== "person.link")
      throw new CliError("validation_error", "meeting linking supports only explicit event or person changes")
    const result = await (await deps.integration()).change(target.reference, change, {
      apply: options.yes,
      dryRun: options.dryRun,
      signal: deps.signal(),
    })
    if (result.applied) await deps.receipt(itemOf(result))
    else deps.output(itemOf(result))
  }
  const nullableId = (value: string): number | "none" => (value === "none" ? "none" : bytes(value))
  label(
    guards(
      meetings
        .command("update")
        .description("preview linking a stored meeting to an event; --yes applies it")
        .argument("<reference>", "meeting reference, such as meeting:1/1")
        .requiredOption("--event-id <id>", "stored event id, or none to unlink", nullableId)
        .option("--expected-event-id <id>", "compare current event id, or none", nullableId),
    ).action(
      async (
        reference: string,
        options: { eventId: number | "none"; expectedEventId?: number | "none"; yes?: boolean; dryRun?: boolean },
      ) =>
        apply(
          reference,
          {
            action: "event.link",
            eventId: options.eventId === "none" ? null : options.eventId,
            ...(options.expectedEventId === undefined
              ? {}
              : { expectedEventId: options.expectedEventId === "none" ? null : options.expectedEventId }),
          },
          options,
        ),
    ),
    "zm personal meetings update meeting:1/1 --event-id 1 --json",
    true,
  )
  label(
    guards(
      meetings
        .command("link")
        .description("preview linking a meeting participant to a stored person; --yes applies it")
        .argument("<reference>", "meeting reference, such as meeting:1/1")
        .requiredOption("--participant-id <id>", "participant id from this meeting", bytes)
        .requiredOption("--person <uid>", "explicit stored person UID")
        .option("--source <accounts>", "explicit additional account ids authorized for target-person lookup")
        .option("--expected-person <uid>", "compare current person UID, or none"),
    ).action(
      async (
        reference: string,
        options: {
          participantId: number
          person: string
          source?: string
          expectedPerson?: string
          yes?: boolean
          dryRun?: boolean
        },
      ) =>
        apply(
          reference,
          {
            action: "person.link",
            participantId: options.participantId,
            personUid: options.person,
            ...(options.source === undefined
              ? {}
              : { targetAccountIds: options.source.split(",").map((item) => bytes(item.trim())) }),
            ...(options.expectedPerson === undefined
              ? {}
              : { expectedPersonUid: options.expectedPerson === "none" ? null : options.expectedPerson }),
          },
          options,
        ),
    ),
    "zm personal meetings link meeting:1/1 --participant-id 1 --person 1 --json",
    true,
  )
}
