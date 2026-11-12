import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { isMovedRun, type Paths, resolvePaths } from "@wirecat/cli-base"

type FolderOptions = Pick<Parameters<typeof resolvePaths>[0], "env" | "platform">

const APP = "zoom-cli"
const PREFIX = "ZM"
const KINDS = ["config", "state", "cache"] as const
const overrideOf = (kind: (typeof KINDS)[number]) => `${PREFIX}_${kind.toUpperCase()}_DIR`

const withoutOverrides = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !KINDS.some((kind) => overrideOf(kind) === name)))

/** Older versions kept zm's folders under `zm`; the archive timers it installed still name that config folder. */
const legacyPaths = ({ env = process.env, platform }: FolderOptions = {}): Paths =>
  resolvePaths({ appName: "zm", prefix: PREFIX, env: withoutOverrides(env), ...(platform ? { platform } : {}) })

/**
 * The archive timer sets `ZM_CONFIG_DIR` to the default folder. That names the owner's own folder, so it must not make
 * the run a moved one, which would keep its refreshed sign-in apart from the owner's.
 */
const ownEnv = ({ env = process.env, platform }: FolderOptions = {}): NodeJS.ProcessEnv => {
  const base = withoutOverrides(env)
  const current = resolvePaths({ appName: APP, prefix: PREFIX, env: base, ...(platform ? { platform } : {}) })
  const legacy = legacyPaths({ env, ...(platform ? { platform } : {}) })
  const kept = { ...env }
  for (const kind of KINDS) {
    const value = env[overrideOf(kind)]
    if (value !== undefined && [current[kind], legacy[kind]].includes(resolve(value))) delete kept[overrideOf(kind)]
  }
  return kept
}

/** cli-core reads the `ZM_*_DIR` variables too, so one naming the owner's own folder goes before anything starts. */
export const dropOwnFolderOverrides = (env: NodeJS.ProcessEnv = process.env): void => {
  const own = ownEnv({ env })
  for (const kind of KINDS) if (own[overrideOf(kind)] === undefined) delete env[overrideOf(kind)]
}

export const zmPaths = (options: FolderOptions = {}): Paths =>
  resolvePaths({ appName: APP, prefix: PREFIX, ...options, env: ownEnv(options) })

/** WC-SECR-24: such a run reads the owner's sign-in but never replaces or deletes it. */
export const isMovedZmRun = (options: FolderOptions = {}): boolean =>
  isMovedRun({ appName: APP, prefix: PREFIX, ...options, env: ownEnv(options) })

/** The keyring service older versions used: one per config folder, so a moved run never saw the owner's sign-in. */
export const legacyLoginService = (options: FolderOptions = {}): string =>
  `${APP}:${resolvePaths({ appName: "zm", prefix: PREFIX, ...options }).config}`

/** A saved archive schedule names the config folder it was made in, which may still be the old `zm` one. */
export const sameConfigFolder = (current: string, saved: string, options: FolderOptions = {}): boolean =>
  resolve(current) === resolve(saved) ||
  (resolve(saved) === legacyPaths(options).config && resolve(current) === zmPaths(options).config)

/** Moves what the old `zm` folders hold into the `zoom-cli` ones. Anything already there wins; its old copy stays. */
export const moveLegacyFolders = (options: FolderOptions = {}): void => {
  const env = ownEnv(options)
  const current = zmPaths(options)
  const legacy = legacyPaths(options)
  for (const kind of KINDS) {
    if (env[overrideOf(kind)] !== undefined || current[kind] === legacy[kind] || !existsSync(legacy[kind])) continue
    // A failed step leaves the entry where it was: another process moved it first, or the new folder has its own.
    const attempt = (step: () => void) => {
      try {
        step()
      } catch {}
    }
    attempt(() => mkdirSync(current[kind], { recursive: true, mode: 0o700 }))
    let names: string[] = []
    attempt(() => {
      names = readdirSync(legacy[kind])
    })
    for (const name of names)
      if (!existsSync(join(current[kind], name)))
        attempt(() => renameSync(join(legacy[kind], name), join(current[kind], name)))
    attempt(() => rmdirSync(legacy[kind]))
  }
}
