import { CliError } from "@wirecat/cli-base"
import { canonicalMeetingReference, parseMeetingReference } from "@wirecat/cli-core"
import type { MeetingContextChange, MeetingContextReceipt, MeetingMutationOptions } from "@wirecat/cli-core/meetings"

export type MeetingLinkChange = Extract<MeetingContextChange, { action: "event.link" | "person.link" }>
export interface MeetingIntegrationCapabilities {
  change(
    reference: string,
    change: MeetingLinkChange,
    options?: MeetingMutationOptions,
  ): Promise<MeetingContextReceipt<unknown>>
}

export const integrationReference = (reference: string) => {
  const parsed = parseMeetingReference(reference)
  if (parsed.transcriptId !== undefined)
    throw new CliError("validation_error", "this operation requires a root meeting reference")
  return { parsed, reference: canonicalMeetingReference(reference) }
}
