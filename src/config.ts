import { existsSync } from "node:fs"
import { CliError, isCliError, saveConfigFile } from "@wirecat/cli-base"
import { loadSnakeCaseConfig } from "@wirecat/cli-core/cli"
import * as v from "valibot"
import { type ConfiguredContextSource, contextSourcesSchema, replaceContextSources } from "./context-sources.js"
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
  /** The profile that owns a login saved before profiles were words; only that one may take it over. */
  legacyProfile: string | null
  contextSources?: ConfiguredContextSource[]
}

const ProfileEntry = v.strictObject({})

const ConfigFile = v.strictObject({
  client_id: v.nullable(
    v.pipe(
      v.string(),
      v.check((id) => id.trim() !== "" && !/\s/.test(id)),
    ),
  ),
  source: v.picklist(["api", "files"]),
  files_folder: v.nullable(v.string()),
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
        }),
      ),
    ),
  ),
  account_profile: v.optional(v.nullable(v.pipe(v.string(), v.regex(profilePattern)))),
  profiles: v.optional(v.record(v.pipe(v.string(), v.regex(profilePattern)), ProfileEntry)),
  context_sources: v.optional(contextSourcesSchema),
})

// The loader's issue text quotes the offending value ("received …"), which can be the client id.
const keyOnly = (message: string): string => {
  const [head, first] = message.split("\n")
  const key = first?.trim().split(":")[0]
  return key ? `${head?.replace(/:$/, "")}: ${key}` : message
}

export const readConfig = (path: string): ZoomConfig => {
  try {
    const file = loadSnakeCaseConfig(path, ConfigFile, () => {
      if (existsSync(path)) throw new CliError("configuration_error", `${path} could not be read`)
      return {
        client_id: null,
        source: "api" as const,
        files_folder: null,
        files_timezone: null,
        account_profile: null,
      }
    })
    return {
      clientId: file.client_id,
      source: file.source,
      filesFolder: file.files_folder,
      filesTimezone: file.files_timezone ?? null,
      profiles: [
        ...new Set([...Object.keys(file.profiles ?? {}), ...(file.account_profile ? [file.account_profile] : [])]),
      ].sort(),
      legacyProfile: file.account_profile ?? null,
      ...(file.context_sources === undefined ? {} : { contextSources: file.context_sources }),
    }
  } catch (error) {
    if (isCliError(error)) throw new CliError("configuration_error", keyOnly(error.message))
    throw new CliError("configuration_error", `${path} could not be read`)
  }
}

const saveConfig = (path: string, config: ZoomConfig): void =>
  saveConfigFile(path, {
    client_id: config.clientId,
    source: config.source,
    files_folder: config.filesFolder,
    files_timezone: config.filesTimezone,
    ...(config.legacyProfile ? { account_profile: config.legacyProfile } : {}),
    profiles: Object.fromEntries(config.profiles.map((name) => [name, {}])),
    ...(config.contextSources === undefined ? {} : { context_sources: config.contextSources }),
  })

/** `profile`: the one named on the command line, for the settings that belong to a profile. */
export const setConfig = (path: string, key: string, value: string, profile?: () => string): ZoomConfig => {
  const config = readConfig(path)
  switch (key) {
    case "context.sources":
      config.contextSources = replaceContextSources(value, profile?.() ?? null, config.contextSources)
      break
    case "zoom.client_id":
    case "zoom.clientId":
      if (!value.trim() || /\s/.test(value))
        throw new CliError("validation_error", "client id must not contain whitespace")
      config.clientId = value
      break
    case "account.profile":
      throw new CliError(
        "validation_error",
        `the profile is the first word now, not a setting: \`zm ${profilePattern.test(value) ? value : "<profile>"} …\``,
        { profiles: config.profiles },
      )
    case "source":
      if (value !== "api" && value !== "files") throw new CliError("validation_error", "source must be api or files")
      config.source = value
      break
    case "files.folder":
      if (!value.trim()) throw new CliError("validation_error", "folder must not be empty")
      config.filesFolder = value
      break
    case "files.timezone":
      try {
        new Intl.DateTimeFormat("en", { timeZone: value })
      } catch {
        throw new CliError("validation_error", "expected an IANA time zone")
      }
      config.filesTimezone = value
      break
    default:
      throw new CliError("validation_error", "unknown config key")
  }
  saveConfig(path, config)
  return config
}

/** A successful login makes a profile; the store account and the archive follow it by name. */
export const addProfile = (path: string, profile: string): void => {
  const config = readConfig(path)
  if (config.profiles.includes(profile)) return
  config.profiles = [...config.profiles, profile].sort()
  saveConfig(path, config)
}

/** The zone a transcript file name's time is read in: `files.timezone`, else this computer's. */
export const filesZone = (config: Pick<ZoomConfig, "filesTimezone">): string =>
  config.filesTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
