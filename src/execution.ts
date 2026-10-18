import {
  CliError,
  createDeadline,
  createOutputBuffer,
  type Deadline,
  type OutputBuffer,
  type SleepLike,
} from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import type { Meta } from "@wirecat/cli-base/standards"
import type { Command } from "commander"
import { readMetadata } from "./answers.js"

export const duration = (text: string): number => {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text)
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match?.[2] ?? "ms"]
  const value = Number(match?.[1]) * (unit ?? 1)
  if (!match || !Number.isSafeInteger(value) || value <= 0 || value > 2147483647)
    throw new CliError("validation_error", "timeout must be a positive duration such as 30s, 5m or 1h")
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
export interface ExecutionOptions {
  signal?: AbortSignal
  sleep?: SleepLike
  now?: () => number
}
export interface ExecutionState {
  action: Command
  deadline: Deadline
  output: OutputBuffer
  meta: () => Meta
}
export const startExecution = (action: Command, options: ExecutionOptions): ExecutionState => {
  const flags = action.optsWithGlobals()
  return {
    action,
    meta: readMetadata(options.now),
    deadline: createDeadline({
      timeoutMs: flags.timeout ?? commandDeadline(action),
      signal: options.signal,
      sleep: options.sleep,
    }),
    output: createOutputBuffer({ maxOutputBytes: flags.maxOutputBytes }),
  }
}

export const resetCliOptions = (root: Command): void => {
  for (const command of [root, ...root.commands]) {
    for (const option of command.options) {
      const name = option.attributeName()
      if (command.getOptionValueSource(name) === "cli")
        command.setOptionValueWithSource(name, option.defaultValue ?? (option.negate ? true : undefined), "default")
    }
    if (command !== root && command.commands.length) resetCliOptions(command)
  }
}
