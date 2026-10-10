import { constants } from "node:fs"
import { type FileHandle, lstat, open } from "node:fs/promises"
import { ZoomError } from "./errors.js"

// Node 22's Windows path stat uses a 64-bit volume serial; handle stat uses its low DWORD.
const deviceOf = (dev: bigint) => (process.platform === "win32" ? BigInt.asUintN(32, dev) : dev)

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
    if (!opened.isFile() || !after.isFile() || before.ino !== opened.ino || before.ino !== after.ino)
      throw new ZoomError("validation_error", "archive file changed while opening")
    if (process.platform === "win32" && before.dev === 0n && after.dev === 0n) {
      // Older Windows path stats omit the device; compare two handles before any content read.
      const witness = await open(path, flags)
      try {
        const identified = await witness.stat({ bigint: true })
        const final = await lstat(path, { bigint: true })
        if (
          opened.dev === 0n ||
          !identified.isFile() ||
          !final.isFile() ||
          deviceOf(identified.dev) !== deviceOf(opened.dev) ||
          identified.ino !== opened.ino ||
          final.ino !== before.ino ||
          (final.dev !== 0n && deviceOf(final.dev) !== deviceOf(opened.dev))
        )
          throw new ZoomError("validation_error", "archive file changed while opening")
      } finally {
        await witness.close()
      }
    } else if (deviceOf(before.dev) !== deviceOf(opened.dev) || deviceOf(before.dev) !== deviceOf(after.dev)) {
      throw new ZoomError("validation_error", "archive file changed while opening")
    }
    return file
  } catch (error) {
    await file.close()
    throw error
  }
}
