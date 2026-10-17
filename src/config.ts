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
  filesTimezone: string
  accountProfile: string | null
  contextSources?: ConfiguredContextSource[]
}

const ConfigFile = v.strictObject({
  client_id: v.nullable(
    v.pipe(
      v.string(),
      v.check((id) => id.trim() !== "" && !/\s/.test(id)),
    ),
  ),
  source: v.picklist(["api", "files"]),
  files_folder: v.nullable(v.string()),
  files_timezone: v.pipe(
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
  account_profile: v.optional(v.nullable(v.pipe(v.string(), v.regex(profilePattern)))),
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
        files_timezone: "UTC",
        account_profile: null,
      }
    })
    return {
      clientId: file.client_id,
      source: file.source,
      filesFolder: file.files_folder,
      filesTimezone: file.files_timezone,
      accountProfile: file.account_profile ?? null,
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
    account_profile: config.accountProfile,
    ...(config.contextSources === undefined ? {} : { context_sources: config.contextSources }),
  })

export const setConfig = (path: string, key: string, value: string): ZoomConfig => {
  const config = readConfig(path)
  switch (key) {
    case "context.sources":
      config.contextSources = replaceContextSources(value, config.accountProfile, config.contextSources)
      break
    case "zoom.client_id":
    case "zoom.clientId":
      if (!value.trim() || /\s/.test(value))
        throw new CliError("validation_error", "client id must not contain whitespace")
      config.clientId = value
      break
    case "account.profile":
      if (!profilePattern.test(value))
        throw new CliError(
          "validation_error",
          "profile must be 1-64 letters, digits, dots, underscores or hyphens and start with a letter or digit",
        )
      config.accountProfile = value
      break
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
