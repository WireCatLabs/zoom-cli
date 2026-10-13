import { annotate } from "@wirecat/cli-base/commands"
import { validateMeetingContextChange } from "@wirecat/cli-core/meetings"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
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
    output: (value: unknown) => void
    receipt: (value: unknown) => Promise<void>
  },
) => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new ZoomError("configuration_error", "meeting command group is unavailable")
  const label = (command: Command, example: string, mutates = false) =>
    annotate(command, {
      origin: "handwritten",
      mutates,
      ...(mutates ? { local: true } : {}),
      examples: [example],
    })
  const guards = (command: Command) =>
    command.option("--yes", "apply this local change once").option("--dry-run", "preview even when --yes is present")
  const apply = async (reference: string, input: MeetingLinkChange, options: { yes?: boolean; dryRun?: boolean }) => {
    const target = integrationReference(reference)
    const change = validateMeetingContextChange(input)
    if (change.action !== "event.link" && change.action !== "person.link")
      throw new ZoomError("validation_error", "meeting linking supports only explicit event or person changes")
    const result = await (await deps.integration()).change(target.reference, change, {
      apply: options.yes,
      dryRun: options.dryRun,
      signal: deps.signal(),
    })
    if (result.applied) await deps.receipt(result)
    else deps.output(result)
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
    "zm meetings update meeting:1/1 --event-id 1 --yes --json",
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
        .option("--target-accounts <ids>", "explicit additional account ids authorized for target-person lookup")
        .option("--expected-person <uid>", "compare current person UID, or none"),
    ).action(
      async (
        reference: string,
        options: {
          participantId: number
          person: string
          targetAccounts?: string
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
            ...(options.targetAccounts === undefined
              ? {}
              : { targetAccountIds: options.targetAccounts.split(",").map((item) => bytes(item.trim())) }),
            ...(options.expectedPerson === undefined
              ? {}
              : { expectedPersonUid: options.expectedPerson === "none" ? null : options.expectedPerson }),
          },
          options,
        ),
    ),
    "zm meetings link meeting:1/1 --participant-id 1 --person 1 --yes --json",
    true,
  )
}
