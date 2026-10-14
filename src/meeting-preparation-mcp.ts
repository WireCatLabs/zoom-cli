import { CliError, errorObjectOf, mcpErrorResult } from "@wirecat/cli-base"
import { callMeetingPreparationTool, REMOTE_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { hostFailureContext } from "./answer-policy.js"
import { readMetadata, toolAnswer } from "./answers.js"
import {
  createZoomPreparationReader,
  type PreparationConnection,
  type ZoomPreparationOptions,
} from "./meeting-preparation.js"

export const readPreparationTool = async (
  deps: {
    connectStore: () => Promise<PreparationConnection>
    preparation?: ZoomPreparationOptions
    commandRegistry?: Command
    now?: () => number
  },
  input: unknown,
  signal: AbortSignal,
) => {
  const meta = readMetadata(deps.now)
  const result = await callMeetingPreparationTool(
    async (seriesId, request) => {
      if (!deps.preparation) throw new CliError("configuration_error", "meeting preparation is not enabled")
      return createZoomPreparationReader({ ...deps.preparation, connect: deps.connectStore })(seriesId, request)
    },
    input,
    signal,
    hostFailureContext(deps.commandRegistry, REMOTE_READ),
    deps.now?.(),
  )
  if ("isError" in result && result.isError) return result
  if (signal.aborted)
    return mcpErrorResult(
      errorObjectOf(
        new CliError("cancelled", "meeting preparation was cancelled"),
        hostFailureContext(undefined, REMOTE_READ),
      ),
    )
  const answer = toolAnswer(result.structuredContent, meta(), deps.commandRegistry)
  return { content: [{ type: "text" as const, text: JSON.stringify(answer) }], structuredContent: answer }
}
