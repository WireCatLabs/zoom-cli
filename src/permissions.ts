import { CliError } from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import { LEVELS, type Level, levelFor } from "@wirecat/cli-core/sends"
import type { Command } from "commander"
import { PROFILE_FREE } from "./commands.js"
import type { ZoomConfig } from "./config.js"
import { refusalOf, refuseChangeWhenReadOnly } from "./read-only.js"

/** A change to Zoom asks first. A built-in default only tightens what the owner set (WC-PERM-7). */
export const DEFAULT_PERMISSIONS: Readonly<Record<string, Level>> = { "remote-meetings": "ask" }

/** Looking after the tool — its settings, its login, its help — is never gated (WC-PERM-5). */
const HOUSEKEEPING = new Set([...PROFILE_FREE, "session", "serve", "mcp"])

const pathOf = (command: Command): string[] => {
  const words: string[] = []
  for (let at: Command | null = command; at?.parent; at = at.parent) words.unshift(at.name())
  return words
}

/** The command's path, dotted — `remote-meetings.cancel` — or null for housekeeping. */
export const permissionKeyOf = (command: Command): string | null => {
  const path = pathOf(command)
  return path.length === 0 || HOUSEKEEPING.has(path[0] as string) ? null : path.join(".")
}

/** Every key a permission may name: each command's path and every group above it. */
export const permissionKeys = (program: Command): Set<string> => {
  const keys = new Set<string>()
  const walk = (command: Command) => {
    const key = permissionKeyOf(command)
    if (key) keys.add(key)
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
  const own = named === undefined ? {} : (context.config().permissions[named] ?? {})
  const { level, key: by } = levelFor(own, key, DEFAULT_PERMISSIONS)
  const at = by ?? key
  if (level === "deny") throw refuse(at, level, profile, "refused")
  const changes = refusalOf(command)
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
  return checkPermission(command, { ...context, ...(confirm ? { confirm } : {}) })
}
