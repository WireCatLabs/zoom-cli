import { CliError, createOutputBuffer, type OutputBuffer } from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import type { Meta } from "@wirecat/cli-base/standards"
import { type BaseEnvironment, parseDuration } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { readMetadata } from "./answers.js"

export const duration = (text: string, source = "duration"): number => {
  const value = parseDuration(text, source)
  if (!Number.isSafeInteger(value) || value > 2147483647)
    throw new CliError("validation_error", "duration exceeds the supported timer range")
  return value
}
export const bytes = (text: string): number => {
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new CliError("validation_error", "expected a nonnegative whole byte count")
  return Number(text)
}
const longRunning = new WeakSet<Command>()
/** A one-shot command that may take an hour; cli-base's `lifetime` names only commands that never end on their own. */
export const runsLong = (command: Command): Command => {
  longRunning.add(command)
  return command
}
export const commandDeadline = (action: Command): number | undefined => {
  const { lifetime } = metaOf(action)
  if (lifetime === "persistent") return undefined
  if (lifetime === "interactive") return 300000
  return longRunning.has(action) ? 3600000 : 30000
}
export interface ExecutionState {
  action: Command
  signal: AbortSignal
  output: OutputBuffer
  meta: () => Meta
}

export const sharedExecution = (action: Command, environment: BaseEnvironment, now?: () => number): ExecutionState => {
  const max = action.optsWithGlobals().maxOutputBytes
  return {
    action,
    signal: environment.signal as AbortSignal,
    meta: readMetadata(now),
    output: createOutputBuffer({ maxOutputBytes: max === undefined ? undefined : Number(max) }),
  }
}
