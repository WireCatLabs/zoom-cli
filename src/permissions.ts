import { CliError } from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import { readOnlyLockOf, setupPermissionCeiling } from "@wirecat/cli-core/cli"
import {
  CEILING_KEY,
  keyForCommand,
  LEVELS,
  type Level,
  levelFor,
  DEFAULT_PERMISSIONS as SHARED_DEFAULT_PERMISSIONS,
} from "@wirecat/cli-core/sends"
import type { Command } from "commander"
import { PROFILE_FREE } from "./commands.js"
import type { ZoomConfig } from "./config.js"
import { refusalOf, refuseChangeWhenReadOnly, ZM } from "./read-only.js"

/** A change to Zoom asks first. A built-in default only tightens what the owner set (WC-PERM-7). */
export const DEFAULT_PERMISSIONS: Readonly<Record<string, Level>> = {
  ...SHARED_DEFAULT_PERMISSIONS,
  "remote-meetings": "ask",
}

/** A saved denial must be reviewed when the two recording download paths become one. */
export const recordingPermissions = (levels: Readonly<Record<string, Level>>): Readonly<Record<string, Level>> => {
  if (Object.hasOwn(levels, "recordings.sync"))
    throw new CliError(
      "configuration_error",
      "permission path moved — rename permissions.recordings.sync to permissions.recordings.download",
      {
        permission: "recordings.sync",
        replacement: "recordings.download",
        retryable: false,
      },
    )
  return levels
}

export const discoveryLevels = (own: Readonly<Record<string, Level>>, env: NodeJS.ProcessEnv) => {
  const ceiling = setupPermissionCeiling(env)
  return {
    ...DEFAULT_PERMISSIONS,
    ...own,
    ...(ceiling ? { [CEILING_KEY]: ceiling } : {}),
    ...(readOnlyLockOf(ZM, env) ? { [CEILING_KEY]: "readonly" as const } : {}),
  }
}

/** Looking after the tool — its settings, its login, its help — is never gated (WC-PERM-5). */
const HOUSEKEEPING = new Set([...PROFILE_FREE, "session", "serve", "mcp"])

export const pathOf = (command: Command): string[] => {
  const words: string[] = []
  for (let at: Command | null = command; at?.parent; at = at.parent) words.unshift(at.name())
  return words
}

/** The command's path, dotted — `remote-meetings.cancel` — or null for housekeeping. */
export const permissionKeyForPath = (path: readonly string[]): string | null =>
  path.length === 0 || (HOUSEKEEPING.has(path[0] as string) && keyForCommand(path) === null) ? null : path.join(".")
export const permissionKeyOf = (command: Command): string | null => permissionKeyForPath(pathOf(command))

/** Every key a permission may name: each command's path and every group above it. */
export const permissionKeys = (program: Command): Set<string> => {
  const keys = new Set<string>(["mcp.authority"])
  const walk = (command: Command) => {
    const key = permissionKeyOf(command)
    if (key) {
      const parts = key.split(".")
      for (let size = 1; size <= parts.length; size++) keys.add(parts.slice(0, size).join("."))
    }
    for (const child of command.commands) walk(child)
  }
  walk(program)
  return keys
}

export const parsePermissions = (value: string, known: ReadonlySet<string>): Record<string, Level> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new CliError("validation_error", 'permissions must be a JSON object: {"remote-meetings": "allow"}')
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new CliError("validation_error", 'permissions must be a JSON object: {"remote-meetings": "allow"}')
  for (const [key, level] of Object.entries(parsed)) {
    if (!known.has(key))
      throw new CliError("validation_error", `no command is called ${key}; a key is a command path, dotted`, {
        keys: [...known].sort(),
      })
    if (!LEVELS.includes(level as Level))
      throw new CliError("validation_error", `${key}: a level is one of ${LEVELS.join(", ")}`)
  }
  return parsed as Record<string, Level>
}

export interface PermissionContext {
  /** Undefined when no profile is named: only the built-in defaults apply, and a command that needs one says so. */
  profile: () => string | undefined
  config: () => Pick<ZoomConfig, "permissions">
  /** A y/N question at a terminal; absent without one or with --no-input. */
  confirm?: (question: string) => Promise<boolean>
  /** The shared first-run answer, which no profile goes above. */
  ceiling?: Level
}

const refuse = (key: string, level: Level, profile: string, what: string) =>
  new CliError(
    "permission_error",
    `${what}: ${key} is ${level} for profile ${profile} — \`zm ${profile} config set permissions …\` changes it`,
    { key, level },
  )

/**
 * Checks a command against its profile's permissions before anything connects. `deny` stops it; `readonly` stops it
 * when it changes something, as `ZM_READ_ONLY` would; `ask` before a change to Zoom wants `--yes` or a yes at the
 * terminal, and `allow` applies it without one. A flag only answers `ask` (WC-PERM-10). `--dry-run` previews.
 */
export const checkPermission = (command: Command, context: PermissionContext): Promise<void> | undefined => {
  const key = permissionKeyOf(command)
  if (!key) return
  const named = context.profile()
  const profile = named ?? "<profile>"
  const own = recordingPermissions(named === undefined ? {} : (context.config().permissions[named] ?? {}))
  const levels = context.ceiling ? { ...own, [CEILING_KEY]: context.ceiling } : own
  const { level, key: by } = levelFor(levels, key, DEFAULT_PERMISSIONS)
  const at = by ?? key
  if (level === "deny") throw refuse(at, level, profile, "refused")
  const changes = refusalOf(command)
  if (level === "readonly" && changes && by === CEILING_KEY)
    throw new CliError(
      "permission_error",
      `refused to ${changes}: the WireCat setup answer keeps every tool read-only — \`tg setup\`, \`max setup\` ` +
        "or `wa setup` at a terminal changes it",
      { key, level },
    )
  if (level === "readonly" && changes) throw refuse(at, level, profile, `refused to ${changes}`)
  const options = command.opts<{ yes?: boolean; dryRun?: boolean }>()
  const confirms = metaOf(command).effects?.remote === "write" && command.options.some(({ long }) => long === "--yes")
  if (!confirms || options.dryRun || options.yes) return
  if (level === "allow") {
    command.setOptionValue("yes", true)
    return
  }
  if (!context.confirm)
    throw new CliError(
      "confirmation_required",
      `${at} asks first for profile ${profile}: add --yes to apply, or --dry-run to preview`,
      { key: at },
    )
  return context.confirm(`zm: ${pathOf(command).join(" ")} changes Zoom for profile ${profile}. Apply?`).then((yes) => {
    if (!yes) throw new CliError("cancelled", "not applied")
    command.setOptionValue("yes", true)
  })
}

/** `ZM_READ_ONLY` first, then the profile's permissions; a promise only while a y/N question is open. */
export const guardCommand = (
  command: Command,
  env: NodeJS.ProcessEnv,
  context: Omit<PermissionContext, "confirm">,
  confirm?: PermissionContext["confirm"],
): Promise<void> | undefined => {
  refuseChangeWhenReadOnly(command, env)
  const ceiling = setupPermissionCeiling(env)
  return checkPermission(command, { ...context, ...(confirm ? { confirm } : {}), ...(ceiling ? { ceiling } : {}) })
}
