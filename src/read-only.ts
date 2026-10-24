import { metaOf } from "@wirecat/cli-base/commands"
import {
  type AppIdentity,
  changesAuthorityNow,
  isLogin,
  isStoreChange,
  readOnlyLockOf,
  readOnlyRefusal,
} from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { VERSION } from "./version.js"

export const ZM: AppIdentity = {
  command: "zm",
  appName: "zoom-cli",
  envPrefix: "ZM",
  description: "Zoom meeting transcripts and summaries",
  version: VERSION,
}

const pathOf = (command: Command): string => {
  const words: string[] = []
  for (let at: Command | null = command; at?.parent; at = at.parent) words.unshift(at.name())
  return words.join(" ")
}

// Building vectors writes beyond the word index, and search by meaning builds missing ones first; with --base-url it
// sends text to that service, which cli-core's lock refuses too.
const usesEmbeddings = (command: Command, path: string): boolean => {
  const options = command.opts()
  if (path === "meetings embeddings") return true
  return path === "search meetings" && options.model !== undefined
}

export const refusalOf = (command: Command): string | undefined => {
  const effects = metaOf(command).effects
  const path = pathOf(command)
  if (isLogin(command)) return "log in or out"
  if (effects?.remote === "write") return "change Zoom"
  if (usesEmbeddings(command, path)) return "build meeting vectors or send text to an embedding service"
  if (changesAuthorityNow(command)) return "change what a later run may do"
  if (!effects || isStoreChange(command)) return "change the message store or local files"
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
