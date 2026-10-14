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
) =>
  addMeetingProjectEvidenceCommand(program, {
    signal: deps.signal,
    now: deps.now,
    output: deps.output,
    read: (project, request) => {
      request.signal?.throwIfAborted()
      return deps.read(project, request)
    },
  }).summary("find project-name and alias evidence in the existing local meeting index")
