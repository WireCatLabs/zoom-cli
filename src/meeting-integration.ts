import { canonicalMeetingReference, parseMeetingReference } from "@wirecat/cli-messaging"
import type {
  MeetingContextChange,
  MeetingContextReceipt,
  MeetingMutationOptions,
} from "@wirecat/cli-messaging/meetings"
import { ZoomError } from "./errors.js"

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
    throw new ZoomError("validation_error", "this operation requires a root meeting reference")
  return { parsed, reference: canonicalMeetingReference(reference) }
}
