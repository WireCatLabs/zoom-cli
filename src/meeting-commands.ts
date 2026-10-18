import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { NO_EFFECTS } from "@wirecat/cli-core/cli"
import { addMeetingCommands } from "@wirecat/cli-core/meetings/cli"
import type { Command } from "commander"
import { runsLong } from "./execution.js"

const childOf = (parent: Command, name: string): Command => {
  const found = parent.commands.find((command) => command.name() === name)
  if (!found) throw new CliError("configuration_error", `shared command is missing: ${name}`)
  return found
}

/** cli-core declares the meeting commands' effects but not its two groups'; zoom's rule covers groups too. */
export const addZoomMeetingCommands = (program: Command, deps: Parameters<typeof addMeetingCommands>[1]): void => {
  addMeetingCommands(program, deps)
  const meetings = annotate(childOf(program, "meetings"), { effects: NO_EFFECTS })
  annotate(childOf(program, "events"), { effects: NO_EFFECTS })
  runsLong(childOf(meetings, "sync"))
}
