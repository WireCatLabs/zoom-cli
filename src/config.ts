import { existsSync } from "node:fs"
import { CliError, saveConfigFile } from "@wirecat/cli-base"
import { loadSnakeCaseConfig } from "@wirecat/cli-core/cli"
import * as v from "valibot"

export interface ZoomConfig {
  clientId: string | null
  source: "api" | "files"
  filesFolder: string | null
  filesTimezone: string
  accountProfile: string | null
}
const profilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const profileAccountKey = (profile: string): string => `zm-profile:${profile}`

const ConfigFile = v.object({
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
})

export const readConfig = (path: string): ZoomConfig => {
  try {
    const file = loadSnakeCaseConfig(path, ConfigFile, () => {
      if (existsSync(path)) throw new Error("unreadable")
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
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("are the same setting"))
      throw new CliError("configuration_error", error.message)
    throw new CliError("configuration_error", "zm config is invalid")
  }
}

const saveConfig = (path: string, config: ZoomConfig): void =>
  saveConfigFile(path, {
    client_id: config.clientId,
    source: config.source,
    files_folder: config.filesFolder,
    files_timezone: config.filesTimezone,
    account_profile: config.accountProfile,
  })

export const setConfig = (path: string, key: string, value: string): ZoomConfig => {
  const config = readConfig(path)
  switch (key) {
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
