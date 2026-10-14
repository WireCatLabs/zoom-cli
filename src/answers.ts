import { randomUUID } from "node:crypto"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { errorObjectSchema, jsonSchemaOf, type Meta } from "@wirecat/cli-base/standards"
import { itemOf, listOf, metaNow, runnable, sealed, answerSchema as sharedAnswerSchema } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import * as v from "valibot"
import { ZoomError } from "./errors.js"
import { snakeKeys } from "./keys.js"

export const answerSchema = sharedAnswerSchema()
const outputSchema: Record<string, unknown> = { ...jsonSchemaOf(v.union([answerSchema, errorObjectSchema])) }
export const toolAnswerSchema: NonNullable<Tool["outputSchema"]> = { ...outputSchema, type: "object" }

export const readMetadata = (now: () => number = Date.now): (() => Meta) => {
  const started = now()
  const runId = randomUUID()
  return () => metaNow({ run_id: runId, duration_ms: Math.max(0, Math.round(now() - started)) })
}

/** Seal standard bodies; keep report-specific coverage and cursors together inside one item. */
export const meetingAnswer = (value: unknown, meta: Meta, registry?: Command) => {
  if (value === undefined) throw new ZoomError("invalid_response", "command returned no answer")
  const data = snakeKeys(value)
  let body: unknown
  if (Array.isArray(data))
    body = sealed(listOf("list", { items: data, limit: Math.max(1, data.length), has_more: false, meta }))
  else if (data && typeof data === "object") {
    const record = data as Record<string, unknown>
    const reportedMeta = record.meta as Partial<Meta> | undefined
    if (
      Object.keys(record).every((key) => ["item", "items", "page", "next", "missing", "meta"].includes(key)) &&
      ("item" in record || (Array.isArray(record.items) && record.page && typeof record.page === "object"))
    )
      body = {
        ...record,
        meta: metaNow({
          ...meta,
          ...reportedMeta,
          complete: reportedMeta?.complete ?? !reportedMeta?.issues?.length,
          run_id: meta.run_id,
          duration_ms: meta.duration_ms,
        }),
      }
    else if (
      Array.isArray(record.items) &&
      Object.keys(record).every((key) => ["items", "page", "limit", "has_more"].includes(key))
    )
      body = {
        items: record.items,
        page: {
          mode: "page",
          limit: Math.max(1, typeof record.limit === "number" ? record.limit : record.items.length),
          has_more: record.has_more === true,
        },
        meta,
      }
    else body = sealed(itemOf(data, { meta }))
  } else body = { item: data, meta }
  const answer = v.safeParse(answerSchema, body)
  if (!answer.success) throw new ZoomError("invalid_response", "command returned an invalid answer envelope")
  const packet = answer.output
  if (registry && packet.next) {
    const next = runnable(registry, packet.next)
    if (next.length) packet.next = next
    else delete packet.next
  }
  return packet
}
