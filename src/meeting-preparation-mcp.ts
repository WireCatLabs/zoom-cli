import { CliError, errorObjectOf, mcpErrorResult } from "@wirecat/cli-base"
import { callMeetingPreparationTool, meetingPreparationTool, REMOTE_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { hostFailureContext } from "./answer-policy.js"
import { readMetadata, toolAnswer } from "./answers.js"
import type { ContextCapture } from "./meeting-communications-binding.js"
import {
  createZoomPreparationReader,
  type PreparationConnection,
  type PreparationStoreRequest,
  type ZoomPreparationOptions,
} from "./meeting-preparation.js"

const schemaObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CliError("configuration_error", "shared preparation schema does not support scoped context selections")
  return value as Record<string, unknown>
}
export const preparationToolFor = (context?: ContextCapture) => {
  const inputSchema = structuredClone(meetingPreparationTool.inputSchema)
  const properties = schemaObject(schemaObject(inputSchema).properties)
  if (context?.ids.length) {
    const sources = schemaObject(schemaObject(schemaObject(properties.communications).properties).sources)
    const id = schemaObject(schemaObject(schemaObject(sources.items).properties).id)
    id.enum = [...context.ids]
  } else delete properties.communications
  return {
    ...meetingPreparationTool,
    inputSchema,
    description: `${meetingPreparationTool.description} ${context?.ids.length ? `Configured communications IDs: ${context.ids.join(", ")}.` : "No communications sources are configured for this profile."}`,
  }
}

export const readPreparationTool = async (
  deps: {
    connectStore: (request?: PreparationStoreRequest) => Promise<PreparationConnection>
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
      return createZoomPreparationReader({ ...deps.preparation, connect: (context) => deps.connectStore({ context }) })(
        seriesId,
        request,
      )
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
