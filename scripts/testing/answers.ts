import { itemEnvelopeSchema, jsonlEndSchema, jsonlItemSchema, listEnvelopeSchema } from "@wirecat/cli-base/standards"
import * as v from "valibot"

const envelope = v.union([itemEnvelopeSchema(v.unknown()), listEnvelopeSchema(v.unknown())])

/** Domain assertions read the payload after independently validating the public wire envelope. */
export const readAnswer = (text: string) => {
  const packet = JSON.parse(text)
  v.parse(envelope, packet)
  return Object.hasOwn(packet, "item") ? packet.item : packet
}

/** Validate the actual wire records, including the final end record, before reading domain rows. */
export const readJsonl = (text: string) => {
  const records = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  if (!records.length || records.at(-1).type !== "end") throw new Error("JSONL answer has no final end record")
  for (const record of records) v.parse(record.type === "item" ? jsonlItemSchema(v.unknown()) : jsonlEndSchema, record)
  return records.filter((record) => record.type === "item").map((record) => record.data)
}

export const readReceipt = (text: string) => {
  let packet: unknown
  try {
    packet = JSON.parse(text)
  } catch {
    packet = undefined
  }
  if (packet !== undefined) return readAnswer(text)
  const rows = readJsonl(text)
  if (rows.length !== 1) throw new Error("expected one JSONL receipt")
  return rows[0]
}

export const readJsonlPage = (text: string) => {
  const items = readJsonl(text)
  const records = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  if (records.filter((record) => record.type === "end").length !== 1) throw new Error("expected one JSONL page")
  const end = records.at(-1)
  return { items, page: end.page, complete: end.complete, issues: end.issues }
}
