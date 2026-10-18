import { metaOf } from "@wirecat/cli-base/commands"
import { type AppIdentity, readOnlyLockOf, readOnlyRefusal } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { VERSION } from "./version.js"

export const ZM: AppIdentity = {
  command: "zm",
  appName: "zoom-cli",
  envPrefix: "ZM",
  description: "Zoom meeting transcripts and summaries",
  version: VERSION,
}

// Their only write is the word index or a store opened read-only. Any other write, one added later too, is refused.
const READS_UNDER_LOCK = new Set(["search meetings", "batch", "serve"])

const pathOf = (command: Command): string => {
  const words: string[] = []
  for (let at: Command | null = command; at?.parent; at = at.parent) words.unshift(at.name())
  return words.join(" ")
}

const changesSomething = (command: Command): boolean => {
  const effects = metaOf(command).effects
  if (!effects) return true
  return effects.remote === "write" || (effects.local === "write" && !READS_UNDER_LOCK.has(pathOf(command)))
}

/** `ZM_READ_ONLY` refuses, by declared effects, every command that changes Zoom or this machine, before it connects. */
export const refuseChangeWhenReadOnly = (command: Command, env: NodeJS.ProcessEnv): void => {
  const lock = readOnlyLockOf(ZM, env)
  if (lock && changesSomething(command)) throw readOnlyRefusal(lock, "change Zoom, the meeting store or local files")
}
