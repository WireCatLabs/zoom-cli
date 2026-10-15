import { CliError } from "@wirecat/cli-base"
import { nativeWriterLeaseStore, type WriterLease, type WriterLeaseInfo } from "@wirecat/cli-core/files"
import { checkCancelled } from "./errors.js"

export interface ArchiveLockInfo {
  name: string
  status: WriterLeaseInfo["status"]
  pid: number | null
  host: string | null
}

const writers = nativeWriterLeaseStore({ markerDirectory: ".zoom-archive-locks", legacyMarker: ".zoom-archive.lock" })
const operation = async <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  checkCancelled(signal)
  try {
    return await run()
  } catch (error) {
    checkCancelled(signal)
    throw error
  }
}

export const inspectArchiveLocks = (
  destination: string,
  options: { signal?: AbortSignal } = {},
): Promise<ArchiveLockInfo[]> => operation(() => writers.inspect(destination, options), options.signal)

export const recoverArchiveLocks = (
  destination: string,
  options: { apply?: boolean; signal?: AbortSignal } = {},
): Promise<{ locks: ArchiveLockInfo[]; removed: string[] }> =>
  operation(() => writers.recover(destination, options), options.signal)

export const acquireArchiveWriter = (destination: string, signal?: AbortSignal): Promise<WriterLease> =>
  operation(async () => {
    const ownership = await writers.acquire(destination, { signal })
    if (ownership.status === "busy")
      throw new CliError("validation_error", "archive is locked; inspect or recover stale local locks")
    if (ownership.status === "legacy") throw new CliError("validation_error", "archive has an unrecognized legacy lock")
    return ownership.lease
  }, signal)
