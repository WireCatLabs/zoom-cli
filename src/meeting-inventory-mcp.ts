import { callMeetingSeriesInventoryTool, type MeetingSeriesInventoryReader, REMOTE_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { hostFailureContext } from "./answer-policy.js"
import { readMetadata, toolAnswer } from "./answers.js"

export const readInventoryTool = async (
  read: MeetingSeriesInventoryReader,
  input: unknown,
  signal: AbortSignal,
  options: { now?: () => number; commandRegistry?: Command },
) => {
  const meta = readMetadata(options.now)
  const result = await callMeetingSeriesInventoryTool(
    read,
    input,
    signal,
    hostFailureContext(options.commandRegistry, REMOTE_READ),
    options.now?.(),
  )
  if (result.isError) return result
  const answer = toolAnswer(result.structuredContent, meta(), options.commandRegistry)
  return { content: [{ type: "text" as const, text: JSON.stringify(answer) }], structuredContent: answer }
}
