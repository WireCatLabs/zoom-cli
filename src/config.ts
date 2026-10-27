import { existsSync, readFileSync, statSync } from "node:fs"
import { CliError, saveConfigFile } from "@wirecat/cli-base"
import { issueMessage } from "@wirecat/cli-core/cli"
import { LEVELS, type Level } from "@wirecat/cli-core/sends"
import * as v from "valibot"
import {
  configIssues,
  fileIssue,
  isNode,
  type LocatedIssue,
  publicIssue,
  removeAt,
  SETTING_NAMES,
  withoutIssues,
} from "./config-issues.js"
import { type ConfiguredContextSource, contextSourcesSchema, replaceContextSources } from "./context-sources.js"
import { parsePermissions } from "./permissions.js"
import { profilePattern } from "./profile.js"

export { profileAccountKey } from "./profile.js"

export interface ZoomConfig {
  clientId: string | null
  source: "api" | "files"
  filesFolder: string | null
  /** `null`: the computer's zone, read when files are imported. */
  filesTimezone: string | null
  /** The profiles on this computer: each one a Zoom login and an account in the shared store. */
  profiles: string[]
  /** What each profile may do: a command path, dotted, to a level (WC-PERM-1). */
  permissions: Record<string, Record<string, Level>>
  contextSources?: ConfiguredContextSource[]
  /** Keep every run, not only the failed ones. */
  record?: boolean
  keepRunsForDays?: number
  keepSuccessfulRunsForDays?: number
  runsSizeLimitMb?: number
  recordInput?: boolean | "failed"
}

const ProfileEntry = v.strictObject({
  permissions: v.optional(v.record(v.pipe(v.string(), v.regex(/^[a-z][a-z.-]*$/)), v.picklist(LEVELS))),
})

const ConfigFile = v.strictObject({
  client_id: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.check((id) => id.trim() !== "" && !/\s/.test(id), "has to be a Zoom client ID, without spaces"),
      ),
    ),
  ),
  source: v.optional(v.picklist(["api", "files"])),
  files_folder: v.optional(v.nullable(v.string())),
  files_timezone: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.check((zone) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: zone })
            return true
          } catch {
            return false
          }
        }, "has to be an IANA time zone, such as Europe/Madrid"),
      ),
    ),
  ),
  profiles: v.optional(
    v.record(
      v.pipe(v.string(), v.regex(profilePattern, "has to be a profile name of 64 characters at most")),
      ProfileEntry,
    ),
  ),
  context_sources: v.optional(contextSourcesSchema),
  record: v.optional(v.boolean()),
  keep_runs_for_days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  keep_successful_runs_for_days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  runs_size_limit_mb: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  record_input: v.optional(v.union([v.boolean(), v.literal("failed")])),
})

const DOCTOR = "zm doctor"

export interface ConfigInspection {
  found: boolean
  /** Every problem in the file; the config below is what loads without them. */
  issues: LocatedIssue[]
  /** The file as written, or null when it is not a JSON object and nothing can be changed in it. */
  raw: Record<string, unknown> | null
  config: ZoomConfig
}

const configOf = (file: v.InferOutput<typeof ConfigFile>): ZoomConfig => ({
  clientId: file.client_id ?? null,
  source: file.source ?? "api",
  filesFolder: file.files_folder ?? null,
  filesTimezone: file.files_timezone ?? null,
  profiles: Object.keys(file.profiles ?? {}).sort(),
  permissions: Object.fromEntries(
    Object.entries(file.profiles ?? {}).flatMap(([name, entry]) =>
      entry.permissions ? [[name, entry.permissions]] : [],
    ),
  ),
  ...(file.context_sources === undefined ? {} : { contextSources: file.context_sources }),
  ...(file.record === undefined ? {} : { record: file.record }),
  ...(file.keep_runs_for_days === undefined ? {} : { keepRunsForDays: file.keep_runs_for_days }),
  ...(file.keep_successful_runs_for_days === undefined
    ? {}
    : { keepSuccessfulRunsForDays: file.keep_successful_runs_for_days }),
  ...(file.runs_size_limit_mb === undefined ? {} : { runsSizeLimitMb: file.runs_size_limit_mb }),
  ...(file.record_input === undefined ? {} : { recordInput: file.record_input }),
})

/**
 * Reads the file without refusing it, for `doctor` and `config`. `permissionKeys`: the command paths a permission may
 * name; without them a saved key is not checked.
 */
export const inspectConfig = (path: string, permissionKeys?: ReadonlySet<string>): ConfigInspection => {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    if (!existsSync(path)) return { found: false, issues: [], raw: {}, config: configOf({}) }
    const what = statSync(path, { throwIfNoEntry: false })?.isDirectory()
      ? "the path is a folder, not a file"
      : "the file could not be read"
    return { found: true, issues: [fileIssue(path, what)], raw: null, config: configOf({}) }
  }
  const { issues, raw } = configIssues(text, path, ConfigFile, permissionKeys)
  return {
    found: true,
    issues,
    raw,
    config: configOf(raw ? v.parse(ConfigFile, withoutIssues(raw, issues)) : {}),
  }
}

/** The settings every command but `config` and `doctor` runs on; a file with any problem is refused. */
export const readConfig = (path: string, permissionKeys?: ReadonlySet<string>): ZoomConfig => {
  const { issues, config } = inspectConfig(path, permissionKeys)
  if (issues.length > 0) throw new CliError("configuration_error", issueMessage(issues.map(publicIssue), DOCTOR))
  return config
}

/** Changes the file as written: whatever else it holds, problems included, stays as it was. */
const changeFile = (
  path: string,
  permissionKeys: ReadonlySet<string> | undefined,
  change: (raw: Record<string, unknown>, inspection: ConfigInspection) => void,
): ZoomConfig => {
  const inspection = inspectConfig(path, permissionKeys)
  if (!inspection.raw)
    throw new CliError("configuration_error", issueMessage(inspection.issues.map(publicIssue), DOCTOR))
  const raw = structuredClone(inspection.raw)
  change(raw, inspection)
  saveConfigFile(path, raw)
  return inspectConfig(path, permissionKeys).config
}

const profileEntry = (raw: Record<string, unknown>, profile: string): Record<string, unknown> => {
  if (!isNode(raw.profiles)) raw.profiles = {}
  const profiles = raw.profiles as Record<string, unknown>
  if (!isNode(profiles[profile])) profiles[profile] = {}
  return profiles[profile] as Record<string, unknown>
}

const FILE_KEYS = Object.fromEntries(Object.entries(SETTING_NAMES).map(([file, name]) => [name, file]))

/**
 * `profile`: the one named on the command line, for the settings that belong to a profile. `permissionKeys`: the
 * command paths a permission may name.
 */
export const setConfig = (
  path: string,
  key: string,
  value: string,
  profile?: () => string | undefined,
  permissionKeys?: ReadonlySet<string>,
): ZoomConfig =>
  changeFile(path, permissionKeys, (raw, { config, issues }) => {
    switch (key) {
      case "permissions": {
        const name = profile?.()
        if (!name) throw new CliError("validation_error", "name a profile: `zm <profile> config set permissions …`")
        profileEntry(raw, name).permissions = parsePermissions(value, permissionKeys ?? new Set())
        return
      }
      case "context.sources": {
        const broken = issues.find((issue) => issue.at[0] === "context_sources")
        if (broken) throw new CliError("configuration_error", issueMessage([publicIssue(broken)], DOCTOR))
        raw.context_sources = replaceContextSources(value, profile?.() ?? null, config.contextSources)
        return
      }
      case "zoom.client_id":
        if (!value.trim() || /\s/.test(value))
          throw new CliError("validation_error", "client id must not contain whitespace")
        raw.client_id = value
        return
      case "source":
        if (value !== "api" && value !== "files") throw new CliError("validation_error", "source must be api or files")
        raw.source = value
        return
      case "files.folder":
        if (!value.trim()) throw new CliError("validation_error", "folder must not be empty")
        raw.files_folder = value
        return
      case "files.timezone":
        try {
          new Intl.DateTimeFormat("en", { timeZone: value })
        } catch {
          throw new CliError("validation_error", "expected an IANA time zone")
        }
        raw.files_timezone = value
        return
      case "record":
        if (value !== "true" && value !== "false")
          throw new CliError("validation_error", "record must be true or false")
        raw.record = value === "true"
        return
      case "keep_runs_for_days":
        if (!/^[1-9]\d{0,4}$/.test(value))
          throw new CliError("validation_error", "keep_runs_for_days must be a whole number of days, 1 or more")
        raw.keep_runs_for_days = Number(value)
        return
      case "record_input":
        if (value !== "true" && value !== "false" && value !== "failed")
          throw new CliError("validation_error", "record_input must be true, false or failed")
        raw.record_input = value === "failed" ? value : value === "true"
        return
      case "keep_successful_runs_for_days":
        if (!/^[1-9]\d{0,4}$/.test(value))
          throw new CliError(
            "validation_error",
            "keep_successful_runs_for_days must be a whole number of days, 1 or more",
          )
        raw.keep_successful_runs_for_days = Number(value)
        return
      case "runs_size_limit_mb":
        if (!/^[1-9]\d{0,5}$/.test(value))
          throw new CliError("validation_error", "runs_size_limit_mb must be a whole number of megabytes, 1 or more")
        raw.runs_size_limit_mb = Number(value)
        return
      default:
        throw new CliError("validation_error", "unknown config key")
    }
  })

/**
 * Removes a setting, or any part of the file `doctor` reports a problem in, by the name its fix gives.
 * `profile`: the one named, if any; `context.sources` without one removes every profile's sources.
 */
export const unsetConfig = (
  path: string,
  key: string,
  profile: string | undefined,
  permissionKeys?: ReadonlySet<string>,
): ZoomConfig =>
  changeFile(path, permissionKeys, (raw, { issues }) => {
    const reported = issues.find(
      (issue) => issue.key === key && (issue.profile === undefined || issue.profile === profile),
    )
    if (key === "context.sources" && !reported && profile !== undefined && Array.isArray(raw.context_sources)) {
      raw.context_sources = raw.context_sources.filter((source) => !isNode(source) || source.profile !== profile)
      return
    }
    const at = reported?.at ?? (FILE_KEYS[key] ? [FILE_KEYS[key]] : profileSettingAt(key, profile))
    removeAt(raw, at)
    // Removing the last permission removes the section, as the file had none before it.
    const entry = isNode(raw.profiles) ? raw.profiles[at[1] ?? ""] : undefined
    if (at[2] === "permissions" && isNode(entry) && isNode(entry.permissions)) {
      if (Object.keys(entry.permissions).length === 0) delete entry.permissions
    }
  })

const profileSettingAt = (key: string, profile: string | undefined): string[] => {
  if (key !== "permissions" && !key.startsWith("permissions."))
    throw new CliError("validation_error", "unknown config key")
  if (!profile) throw new CliError("validation_error", `name a profile: \`zm <profile> config unset ${key}\``)
  return key === "permissions"
    ? ["profiles", profile, "permissions"]
    : ["profiles", profile, "permissions", key.slice("permissions.".length)]
}

/** A successful login makes a profile; the store account and the archive follow it by name. */
export const addProfile = (path: string, profile: string): void => {
  if (readConfig(path).profiles.includes(profile)) return
  changeFile(path, undefined, (raw) => {
    profileEntry(raw, profile)
  })
}

/** The zone a transcript file name's time is read in: `files.timezone`, else this computer's. */
export const filesZone = (config: Pick<ZoomConfig, "filesTimezone">): string =>
  config.filesTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
