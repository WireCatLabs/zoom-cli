import { randomUUID } from "node:crypto"
import type { Tool } from "@modelcontextprotocol/server"
import { CliError } from "@wirecat/cli-base"
import { errorObjectSchema, jsonSchemaOf, type Meta } from "@wirecat/cli-base/standards"
import { metaNow, runnable, answerSchema as sharedAnswerSchema } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import * as v from "valibot"
import { bodyOf } from "./answer-output.js"

export const answerSchema = sharedAnswerSchema()
const outputSchema: Record<string, unknown> = { ...jsonSchemaOf(v.union([answerSchema, errorObjectSchema])) }
export const toolAnswerSchema: NonNullable<Tool["outputSchema"]> = { ...outputSchema, type: "object" }

export const readMetadata = (now: () => number = Date.now): (() => Meta) => {
  const started = now()
  const runId = randomUUID()
  return () => metaNow({ run_id: runId, duration_ms: Math.max(0, Math.round(now() - started)) })
}

/** An MCP tool's result as a validated envelope with the host's run metadata and only runnable next steps. */
export const toolAnswer = (value: unknown, meta: Meta, registry?: Command) => {
  if (value === undefined) throw new CliError("invalid_response", "command returned no answer")
  const body = bodyOf(value)
  const answer = v.safeParse(answerSchema, {
    ...body,
    meta: metaNow({ ...body.meta, run_id: meta.run_id, duration_ms: meta.duration_ms }),
  })
  if (!answer.success) throw new CliError("invalid_response", "command returned an invalid answer envelope")
  const packet = answer.output
  if (registry && packet.next) {
    const next = runnable(registry, packet.next)
    if (next.length) packet.next = next
    else delete packet.next
  }
  return packet
}
