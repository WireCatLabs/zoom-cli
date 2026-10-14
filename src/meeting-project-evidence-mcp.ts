import { CliError, errorObjectOf, mcpErrorResult } from "@wirecat/cli-base"
import { failureContext } from "@wirecat/cli-core"
import { callMeetingProjectEvidenceTool } from "@wirecat/cli-core/meetings/mcp"
import { readMetadata } from "./answers.js"
import type { StoreConnection } from "./program.js"

/** The shared adapter validates before this host opens a connection, and output follows cleanup. */
export const readProjectEvidenceTool = async (
  deps: { connectStore: () => Promise<StoreConnection>; now?: () => number },
  input: unknown,
  signal: AbortSignal,
) => {
  const meta = readMetadata(deps.now)
  let connection: StoreConnection | undefined
  let closeFailed = false
  let result: Awaited<ReturnType<typeof callMeetingProjectEvidenceTool>>
  try {
    result = await callMeetingProjectEvidenceTool(
      async (project, request) => {
        connection = await deps.connectStore()
        request.signal?.throwIfAborted()
        if (!Number.isSafeInteger(connection.accountId) || connection.accountId < 1)
          throw new CliError("configuration_error", "selected meeting account is unavailable")
        if (!connection.meetingProjectEvidence)
          throw new CliError("configuration_error", "project evidence capability is unavailable")
        return connection.meetingProjectEvidence(project, request)
      },
      input,
      signal,
      failureContext(),
      deps.now?.(),
    )
  } finally {
    try {
      await connection?.close()
    } catch {
      closeFailed = true
    }
  }
  if (closeFailed) return mcpErrorResult(errorObjectOf(undefined, failureContext()))
  if (signal.aborted)
    return mcpErrorResult(errorObjectOf(new CliError("cancelled", "meeting read was cancelled"), failureContext()))
  if ("isError" in result && result.isError) return result
  const answer = { ...result.structuredContent, meta: meta() }
  return { content: [{ type: "text" as const, text: JSON.stringify(answer) }], structuredContent: answer }
}
