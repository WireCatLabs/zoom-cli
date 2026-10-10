import { constants } from "node:fs"
import { type FileHandle, lstat, open } from "node:fs/promises"
import { ZoomError } from "./errors.js"

/** Check the opened object before reading: Windows has no O_NOFOLLOW support. */
export const openOrdinaryFile = async (path: string): Promise<FileHandle> => {
  const before = await lstat(path, { bigint: true })
  if (before.isSymbolicLink())
    throw new ZoomError("validation_error", "archive path must be an ordinary file without a symlink")
  if (!before.isFile()) throw new ZoomError("validation_error", "archive path must be an ordinary file")
  const flags =
    process.platform === "win32"
      ? constants.O_RDONLY
      : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  const file = await open(path, flags)
  try {
    const opened = await file.stat({ bigint: true })
    const after = await lstat(path, { bigint: true })
    if (
      !opened.isFile() ||
      !after.isFile() ||
      before.dev !== opened.dev ||
      before.ino !== opened.ino ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    )
      throw new ZoomError("validation_error", "archive file changed while opening")
    return file
  } catch (error) {
    await file.close()
    throw error
  }
}
