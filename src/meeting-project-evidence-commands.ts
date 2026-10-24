import { annotate } from "@wirecat/cli-base/commands"
import { NO_EFFECTS, overrideSharedContract } from "@wirecat/cli-core/cli"
import type { MeetingProjectDiscoveryReader } from "@wirecat/cli-core/meetings"
import { addMeetingProjectEvidenceCommand } from "@wirecat/cli-core/meetings/cli"
import type { Command } from "commander"

export const addProjectEvidenceCommand = (
  program: Command,
  deps: {
    read: MeetingProjectDiscoveryReader
    signal: () => AbortSignal | undefined
    now?: () => number
    output: (value: unknown) => void
  },
) => {
  const command = addMeetingProjectEvidenceCommand(program, {
    signal: deps.signal,
    now: deps.now,
    output: deps.output,
    read: (project, request) => {
      request.signal?.throwIfAborted()
      return deps.read(project, request)
    },
  })
  if (command.parent)
    overrideSharedContract(
      command.parent,
      "Zoom declares its command groups effect-free because they only hold subcommands.",
      (one) => {
        annotate(one, { effects: NO_EFFECTS })
      },
    )
  return command
}
