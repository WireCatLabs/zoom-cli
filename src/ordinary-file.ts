import { CliError } from "@wirecat/cli-base"
import { openOrdinaryFile as sharedOpen, syncDirectory as sharedSync } from "@wirecat/cli-messaging/files"
import { ZoomError } from "./errors.js"

const withZoomErrors = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof CliError) throw new ZoomError(error.code, error.message)
    throw error
  }
}

export const openOrdinaryFile = (path: string) => withZoomErrors(() => sharedOpen(path))
export const syncDirectory = (path: string) => withZoomErrors(() => sharedSync(path))
