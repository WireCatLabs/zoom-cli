import { CliError } from "@wirecat/cli-base"
import type { StoredMeetingProjectCandidateReader } from "@wirecat/cli-core/services"
import type { StoreConnection } from "./store-connection.js"

/** Each request owns a read-only connection and settles cleanup before output. */
export const createZoomProjectCandidateReader =
  (connect: () => Promise<StoreConnection>): StoredMeetingProjectCandidateReader =>
  async (reference, request = {}) => {
    request.signal?.throwIfAborted()
    const connection = await connect()
    try {
      request.signal?.throwIfAborted()
      if (
        !Number.isSafeInteger(connection.accountId) ||
        connection.accountId < 1 ||
        !connection.meetingProjectCandidates
      )
        throw new CliError("configuration_error", "stored project suggestions are unavailable for this account")
      const result = await connection.meetingProjectCandidates(reference, request)
      request.signal?.throwIfAborted()
      return result
    } finally {
      await connection.close()
    }
  }
