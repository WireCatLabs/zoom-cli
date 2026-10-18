import { CliError, errorObjectOf, mcpErrorResult } from "@wirecat/cli-base"
import { callMeetingProjectCandidatesTool, LOCAL_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { hostFailureContext } from "./answer-policy.js"
import { readMetadata, toolAnswer } from "./answers.js"
import type { PreparationStoreRequest } from "./meeting-preparation.js"
import { createZoomProjectCandidateReader } from "./meeting-project-candidates.js"
import type { StoreConnection } from "./store-connection.js"

export const readProjectCandidatesTool = async (
  deps: {
    connectStore: (request?: PreparationStoreRequest) => Promise<StoreConnection>
    commandRegistry?: Command
    now?: () => number
  },
  input: unknown,
  signal: AbortSignal,
) => {
  const meta = readMetadata(deps.now)
  const result = await callMeetingProjectCandidatesTool(
    createZoomProjectCandidateReader(() => deps.connectStore({})),
    input,
    signal,
    hostFailureContext(deps.commandRegistry, LOCAL_READ),
  )
  if (result.isError) return result
  if (signal.aborted)
    return mcpErrorResult(
      errorObjectOf(
        new CliError("cancelled", "project candidate reading was cancelled"),
        hostFailureContext(undefined, LOCAL_READ),
      ),
    )
  const answer = toolAnswer(result.structuredContent, meta(), deps.commandRegistry)
  return { content: [{ type: "text" as const, text: JSON.stringify(answer) }], structuredContent: answer }
}
