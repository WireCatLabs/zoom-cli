import { itemEnvelopeSchema, listEnvelopeSchema } from "@wirecat/cli-base/standards"
import * as v from "valibot"

const envelope = v.union([itemEnvelopeSchema(v.unknown()), listEnvelopeSchema(v.unknown())])

/** Domain assertions read the payload after independently validating the public wire envelope. */
export const readAnswer = (text: string) => {
  const packet = JSON.parse(text)
  v.parse(envelope, packet)
  return Object.hasOwn(packet, "item") ? packet.item : packet
}
