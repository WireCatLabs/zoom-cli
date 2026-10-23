import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv"
import { itemEnvelopeSchema, jsonlEndSchema, jsonlItemSchema, listEnvelopeSchema } from "@wirecat/cli-base/standards"
import { commandContract } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
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

/** The answer fits the output schema the command publishes for its declared entity; returns Ajv's message, if any. */
export const declaredAnswerIssue = (program: Command, path: string, body: unknown) => {
  let command = program
  for (const word of path.split(" ")) {
    const next = command.commands.find((one) => one.name() === word)
    if (!next) return `no command ${path}`
    command = next
  }
  const contract = commandContract(command)
  if (contract.outputSchemaCoverage !== "declared-entity") return `${path} declares no entity`
  return new AjvJsonSchemaValidator().getValidator<unknown>(contract.outputSchema)(body).errorMessage
}
