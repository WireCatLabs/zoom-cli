import { randomUUID } from "node:crypto"
import { type FileHandle, link, open, unlink } from "node:fs/promises"
import { CliError, isCliError } from "@wirecat/cli-base"
import { checkCancelled } from "./errors.js"

export const writeExportFile = async (
  path: string,
  content: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> => {
  checkCancelled(options.signal)
  const temporary = `${path}.zm-${randomUUID()}.part`
  let handle: FileHandle | undefined
  let failure: unknown
  let failed = false
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(content, "utf8")
    await handle.sync()
    checkCancelled(options.signal)
    await link(temporary, path)
  } catch (error) {
    failed = true
    failure = error
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
      try {
        await unlink(temporary)
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
  }
  if (!failed) return
  if (isCliError(failure)) throw failure
  const code = typeof failure === "object" && failure !== null && "code" in failure ? failure.code : undefined
  throw new CliError(
    code === "EEXIST"
      ? "validation_error"
      : code === "EACCES" || code === "EPERM"
        ? "permission_error"
        : "configuration_error",
    code === "EEXIST" ? "output file already exists; choose another path" : "could not write the output file",
  )
}
