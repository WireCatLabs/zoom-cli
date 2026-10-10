import { readFileSync } from "node:fs"
import { saveConfigFile } from "@wirecat/cli-core"
import { object, ZoomError } from "./errors.js"

export interface ZoomConfig {
  clientId: string | null
  source: "api" | "files"
  filesFolder: string | null
  filesTimezone: string
}
export const readConfig = (path: string): ZoomConfig => {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return { clientId: null, source: "api", filesFolder: null, filesTimezone: "UTC" }
    throw new ZoomError("configuration_error", "could not read zm config")
  }
  try {
    const value = object(JSON.parse(text))
    if (
      (value.clientId !== null && typeof value.clientId !== "string") ||
      (value.source !== "api" && value.source !== "files") ||
      (value.filesFolder !== null && typeof value.filesFolder !== "string") ||
      typeof value.filesTimezone !== "string"
    )
      throw new Error("invalid config")
    new Intl.DateTimeFormat("en", { timeZone: value.filesTimezone })
    return {
      clientId: value.clientId,
      source: value.source,
      filesFolder: value.filesFolder,
      filesTimezone: value.filesTimezone,
    }
  } catch {
    throw new ZoomError("configuration_error", "zm config is invalid")
  }
}
export const setConfig = (path: string, key: string, value: string): ZoomConfig => {
  const config = readConfig(path)
  switch (key) {
    case "zoom.clientId":
      if (!value.trim()) throw new ZoomError("validation_error", "client id must not be empty")
      config.clientId = value
      break
    case "source":
      if (value !== "api" && value !== "files") throw new ZoomError("validation_error", "source must be api or files")
      config.source = value
      break
    case "files.folder":
      if (!value.trim()) throw new ZoomError("validation_error", "folder must not be empty")
      config.filesFolder = value
      break
    case "files.timezone":
      try {
        new Intl.DateTimeFormat("en", { timeZone: value })
      } catch {
        throw new ZoomError("validation_error", "expected an IANA time zone")
      }
      config.filesTimezone = value
      break
    default:
      throw new ZoomError("validation_error", "unknown config key")
  }
  saveConfigFile(path, config)
  return config
}
