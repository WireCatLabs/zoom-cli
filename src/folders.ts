import { join } from "node:path"
import {
  type KeyringStore,
  type LegacyMove,
  legacyMacPaths,
  type MigrateLegacyPathsOptions,
  migrateLegacyMacPaths,
  type Paths,
  resolvePaths,
} from "@wirecat/cli-base"
import { readConfig } from "./config.js"

/** The login lives in the keyring under the config folder's path, so it has to follow a moved folder. */
export const loginService = (configDir: string) => `zoom-cli:${configDir}`

const copyLogin = (keyring: KeyringStore, from: string, to: string) => {
  const { clientId } = readConfig(join(to, "config.json"))
  if (!clientId || keyring.get(loginService(to), clientId) !== null) return
  const saved = keyring.get(loginService(from), clientId)
  if (saved !== null) keyring.set(loginService(to), clientId, saved)
}

/**
 * zm's folders, after moving them out of `~/Library` on macOS. A move that cannot happen now never
 * stops the command: it warns and this run uses the old folders, so the next run tries again.
 */
export const zmPaths = (
  keyring: KeyringStore,
  warn: (line: string) => void,
  options: Omit<MigrateLegacyPathsOptions, "appName"> = {},
): Paths => {
  const { env = process.env, platform = process.platform } = options
  let moved: LegacyMove | undefined
  try {
    moved = migrateLegacyMacPaths({ ...options, appName: "zm", env, platform }).find((move) => move.kind === "config")
  } catch (error) {
    warn(`zm: kept its files in ~/Library for now — ${(error as Error).message}\n`)
    return legacyMacPaths("zm", env)
  }
  if (moved)
    try {
      copyLogin(keyring, moved.from, moved.to)
    } catch (error) {
      warn(
        `zm: moved its files out of ~/Library but not the login — run \`zm session start\` again (${(error as Error).message})\n`,
      )
    }
  return resolvePaths({ appName: "zm", env, platform })
}
