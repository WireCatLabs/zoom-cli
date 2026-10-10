import { createDeadline, createOutputBuffer, type Deadline, type OutputBuffer, type SleepLike } from "@wirecat/cli-core"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"

export const duration = (text: string): number => {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text)
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match?.[2] ?? "ms"]
  const value = Number(match?.[1]) * (unit ?? 1)
  if (!match || !Number.isSafeInteger(value) || value <= 0 || value > 2147483647)
    throw new ZoomError("validation_error", "timeout must be a positive duration such as 30s, 5m or 1h")
  return value
}
export const bytes = (text: string): number => {
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new ZoomError("validation_error", "expected a nonnegative whole byte count")
  return Number(text)
}
export const commandDeadline = (action: Command): number | undefined => {
  if (action.name() === "watch" || action.name() === "serve") return undefined
  if (action.name() === "login") return 300000
  if (
    action.name() === "download" ||
    action.name() === "sync" ||
    (action.name() === "verify" && action.parent?.name() === "archive")
  )
    return 3600000
  return 30000
}
export interface ExecutionOptions {
  signal?: AbortSignal
  sleep?: SleepLike
}
export interface ExecutionState {
  deadline: Deadline
  output: OutputBuffer
}
export const startExecution = (action: Command, options: ExecutionOptions): ExecutionState => {
  const flags = action.optsWithGlobals()
  return {
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
