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

// Mirrors copy the configured source (Zoom or its downloads folder) into the store or an archive, as tg's sync keeps
// receiving under its lock. The rest write only the word index or open the store read-only. Any other write, one
// added later too, is refused.
const RUNS_UNDER_LOCK = new Set([
  "meetings sync",
  "watch",
  "recordings sync",
  "recordings download",
  "recordings schedule run",
  "search meetings",
  "batch",
  "serve",
])

const pathOf = (command: Command): string => {
  const words: string[] = []
  for (let at: Command | null = command; at?.parent; at = at.parent) words.unshift(at.name())
  return words.join(" ")
}

// Building vectors writes beyond the word index, and search by meaning builds missing ones first; with --base-url it, and serve's semantic tool, send text to that
// service, which cli-core's lock refuses too.
const usesEmbeddings = (command: Command, path: string): boolean => {
  const options = command.opts()
  if (path === "meetings embeddings") return true
  if (path === "search meetings") return options.model !== undefined
  return path === "serve" && options.semantic === true && options.baseUrl !== undefined
}

const refusalOf = (command: Command): string | undefined => {
  const effects = metaOf(command).effects
  const path = pathOf(command)
  if (path === "session start") return "log in or out"
  if (effects?.remote === "write") return "change Zoom"
  if (usesEmbeddings(command, path)) return "build meeting vectors or send text to an embedding service"
  if (!effects || (effects.local === "write" && !RUNS_UNDER_LOCK.has(path)))
    return "change settings, local files or the stored meetings outside a sync"
  return undefined
}

/**
 * `ZM_READ_ONLY` refuses, before anything connects, every command that changes Zoom, the login, settings or what the
 * owner added; syncs and downloads from Zoom still run.
 */
export const refuseChangeWhenReadOnly = (command: Command, env: NodeJS.ProcessEnv): void => {
  const lock = readOnlyLockOf(ZM, env)
  const refusal = lock && refusalOf(command)
  if (lock && refusal) throw readOnlyRefusal(lock, refusal)
}
