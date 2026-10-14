import { createRenderer, projectFields } from "@wirecat/cli-base"
import { type Body, jsonlRecords } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { meetingAnswer } from "./answers.js"
import { snakeKeys } from "./keys.js"
import type { ProgramDeps } from "./program.js"

export const createAnswerRenderer =
  (registry: Command, onAnswer?: (meta: import("@wirecat/cli-base/standards").Meta) => void) =>
  (
    value: unknown,
    format: "json" | "jsonl" | "text",
    deps: ProgramDeps,
    fields?: readonly string[],
    preserveEnvelope = false,
    providerKeys = false,
    seal?: () => import("@wirecat/cli-base/standards").Meta,
  ): string => {
    if (!providerKeys) value = snakeKeys(value)
    if (seal) {
      const packet = meetingAnswer(value, seal(), registry)
      onAnswer?.(packet.meta)
      value = packet
    }
    if (fields) {
      if (seal && value && typeof value === "object" && "item" in value)
        value = { ...value, item: projectFields(value.item, fields) }
      else value = projectFields(value, fields)
    }
    if (seal && format === "jsonl")
      return `${jsonlRecords(value as Body)
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`
    const chunks: string[] = []
    const renderer = createRenderer({
      format: format === "text" ? (deps.outputIsTTY ? "pretty" : "json") : format,
      color: false,
      streams: { data: (text) => chunks.push(`${text}\n`), diagnostic: deps.diagnostic },
    })
    if (
      !preserveEnvelope &&
      !seal &&
      format === "jsonl" &&
      typeof value === "object" &&
      value !== null &&
      "items" in value &&
      Array.isArray(value.items)
    )
      renderer.stream(value.items)
    else renderer.result(value)
    return chunks.join("")
  }
