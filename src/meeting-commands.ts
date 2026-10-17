import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { FETCH, LOCAL_READ, LOCAL_WRITE, NO_EFFECTS } from "@wirecat/cli-core/cli"
import { addMeetingCommands } from "@wirecat/cli-core/meetings/cli"
import type { Command } from "commander"

const childOf = (parent: Command, name: string): Command => {
  const found = parent.commands.find((command) => command.name() === name)
  if (!found) throw new CliError("configuration_error", `shared command is missing: ${name}`)
  return found
}

/** cli-core's meeting commands come without effects, so zoom declares them where it adds them. */
export const addZoomMeetingCommands = (program: Command, deps: Parameters<typeof addMeetingCommands>[1]): void => {
  addMeetingCommands(program, deps)
  const meetings = annotate(childOf(program, "meetings"), { effects: NO_EFFECTS })
  const events = annotate(childOf(program, "events"), { effects: NO_EFFECTS })
  for (const name of ["list", "show", "transcript", "summary", "people"])
    annotate(childOf(meetings, name), { effects: LOCAL_READ })
  for (const name of ["import", "export"]) annotate(childOf(meetings, name), { effects: LOCAL_WRITE })
  annotate(childOf(meetings, "sync"), { effects: FETCH })
  annotate(childOf(events, "list"), { effects: LOCAL_READ })
}
