import { createRenderer, exitCodeOfAnswer, projectFields } from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import type { Meta } from "@wirecat/cli-base/standards"
import { type Body, itemOf, listOf, metaNow, renderAnswer, snakeKeys } from "@wirecat/cli-core/cli"
import type { Command } from "commander"

export type AnswerFormat = "json" | "jsonl" | "pretty"

// Text shows the stored UTC times as they are; a person reads an unlabelled time as local (WC-TIME-4).
const UTC_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key))

/**
 * cli-core's meeting commands and MCP tools return envelopes as plain objects, `listed()` lists or bare reports,
 * not `itemOf`/`listOf` bodies; zoom's own commands build bodies and never come through here.
 */
export const bodyOf = (value: unknown): Body => {
  const data = snakeKeys(value)
  if (record(data) && only(data, ["item", "items", "page", "next", "missing", "meta"])) {
    if ("item" in data || (Array.isArray(data.items) && record(data.page))) return data as unknown as Body
  }
  if (record(data) && Array.isArray(data.items) && only(data, ["items", "page", "limit", "has_more"]))
    return listOf("list", {
      items: data.items,
      limit: Math.max(1, data.items.length),
      has_more: data.has_more === true,
    })
  return itemOf(data)
}

/** The answer as text, and the exit code a partial answer earns. */
export const renderBody = (
  command: Command,
  body: Body,
  options: {
    format: AnswerFormat
    meta: Meta
    fields?: readonly string[]
    quiet?: boolean
    diagnostic: (text: string) => void
  },
): { text: string; exitCode: number } => {
  const data = snakeKeys(body) as Body
  const fields = options.fields
  const projected = fields ? (projectFields(data, fields) as Body) : data
  const meta = metaNow({ ...projected.meta, run_id: options.meta.run_id, duration_ms: options.meta.duration_ms })
  const chunks: string[] = []
  const streams = {
    data: (text: string) => chunks.push(`${text}\n`),
    diagnostic: (text: string) => options.diagnostic(`${text}\n`),
  }
  const renderer = createRenderer({ format: options.format, color: false, quiet: options.quiet, streams })
  // renderAnswer reports a partial answer through process.exitCode; zoom returns that code from `run` instead.
  const exitCode = process.exitCode
  try {
    renderAnswer(command, { renderer, format: options.format, streams }, { ...projected, meta })
  } finally {
    process.exitCode = exitCode
  }
  const text = chunks.join("")
  const label = options.format === "pretty" && UTC_TIME.test(text) ? "times in UTC\n" : ""
  return { text: text + label, exitCode: exitCodeOfAnswer(meta, metaOf(command).partial === true) }
}

/** Every row the command read, in one page. */
export const wholeList = <T>(command: string, items: T[]) =>
  listOf(command, { items, limit: Math.max(1, items.length), has_more: false })

export const usageMessage = (error: Error) => error.message.replace(/^error: |\s*\n\s*/g, " ").trim()
