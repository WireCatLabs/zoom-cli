import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { actorOf, type Body, itemOf, LOCAL_READ, LOCAL_WRITE } from "@wirecat/cli-core/cli"
import { validateMeetingContextChange } from "@wirecat/cli-core/meetings"
import type { Command } from "commander"
import { bytes } from "./execution.js"
import {
  integrationReference,
  type MeetingIntegrationCapabilities,
  type MeetingLinkChange,
} from "./meeting-integration.js"

interface LinkOptions {
  eventId?: number | "none"
  expectedEventId?: number | "none"
  participantId?: number
  person?: string
  source?: string
  expectedPerson?: string
  yes?: boolean
  dryRun?: boolean
}

/** One link per run: a meeting to an event, or one participant to a person. */
const linkChange = (options: LinkOptions): MeetingLinkChange => {
  const toPerson = options.participantId !== undefined || options.person !== undefined
  if ((options.eventId !== undefined) === toPerson)
    throw new CliError("validation_error", "give --event-id, or --participant-id with --person", {
      param: "--event-id",
    })
  if (options.eventId !== undefined) {
    if (options.source !== undefined || options.expectedPerson !== undefined)
      throw new CliError("validation_error", "--source and --expected-person go with --person, not --event-id")
    return {
      action: "event.link",
      eventId: options.eventId === "none" ? null : options.eventId,
      ...(options.expectedEventId === undefined
        ? {}
        : { expectedEventId: options.expectedEventId === "none" ? null : options.expectedEventId }),
    }
  }
  if (options.participantId === undefined || options.person === undefined)
    throw new CliError("validation_error", "--participant-id and --person go together", { param: "--person" })
  if (options.expectedEventId !== undefined)
    throw new CliError("validation_error", "--expected-event-id goes with --event-id")
  return {
    action: "person.link",
    participantId: options.participantId,
    personUid: options.person,
    ...(options.source === undefined
      ? {}
      : { targetAccountIds: options.source.split(",").map((item) => bytes(item.trim())) }),
    ...(options.expectedPerson === undefined
      ? {}
      : { expectedPersonUid: options.expectedPerson === "none" ? null : options.expectedPerson }),
  }
}

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
  const label = (command: Command, examples: string[], mutates = false) =>
    annotate(command, {
      origin: "handwritten",
      effects: mutates ? LOCAL_WRITE : LOCAL_READ,
      examples,
    })
  const guards = (command: Command) =>
    command.option("--yes", "apply this local change once").option("--dry-run", "preview even when --yes is present")
  const apply = async (
    reference: string,
    input: MeetingLinkChange,
    options: { yes?: boolean; dryRun?: boolean },
    command: Command,
  ) => {
    const target = integrationReference(reference)
    const change = validateMeetingContextChange(input)
    if (change.action !== "event.link" && change.action !== "person.link")
      throw new CliError("validation_error", "meeting linking supports only explicit event or person changes")
    const result = await (await deps.integration()).change(target.reference, change, {
      apply: options.yes,
      dryRun: options.dryRun,
      signal: deps.signal(),
      // An agent's terminal or an MCP run links a person only as a proposal the owner confirms.
      author: actorOf(command) === "owner" ? "owner" : "agent",
    })
    if (result.applied) await deps.receipt(itemOf(result))
    else deps.output(itemOf(result))
  }
  const nullableId = (value: string): number | "none" => (value === "none" ? "none" : bytes(value))
  // `meetings update` is the change sent to Zoom (cli-core's meeting management); both local links are `link`.
  label(
    guards(
      meetings
        .command("link")
        .description("link a meeting to an event, or a participant to a person; --yes applies")
        .argument("<reference>", "meeting reference, such as meeting:1/1")
        .option("--event-id <id>", "stored event id, or none to unlink", nullableId)
        .option("--expected-event-id <id>", "with --event-id: compare current event id, or none", nullableId)
        .option("--participant-id <id>", "with --person: participant id from this meeting", bytes)
        .option("--person <uid>", "with --participant-id: explicit stored person UID")
        .option("--source <accounts>", "explicit additional account ids authorized for target-person lookup")
        .option("--expected-person <uid>", "compare current person UID, or none"),
    ).action(async (reference: string, options: LinkOptions, command: Command) =>
      apply(reference, linkChange(options), options, command),
    ),
    [
      "zm personal meetings link meeting:1/1 --event-id 1 --json",
      "zm personal meetings link meeting:1/1 --participant-id 1 --person 1 --json",
    ],
    true,
  )
}
