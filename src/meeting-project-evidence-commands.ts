import type { MeetingProjectDiscoveryReader } from "@wirecat/cli-core/meetings"
import { addMeetingProjectEvidenceCommand } from "@wirecat/cli-core/meetings/cli"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"

export const addProjectEvidenceCommand = (
  program: Command,
  deps: {
    read?: MeetingProjectDiscoveryReader
    connect: () => Promise<{ meetingProjectEvidence?: MeetingProjectDiscoveryReader }>
    signal: () => AbortSignal | undefined
    now?: () => number
    output: (value: unknown) => void
  },
) =>
  addMeetingProjectEvidenceCommand(program, {
    signal: deps.signal,
    now: deps.now,
    output: deps.output,
    read: async (project, request) => {
      const read = deps.read ?? (await deps.connect()).meetingProjectEvidence
      request.signal?.throwIfAborted()
      if (!read) throw new ZoomError("configuration_error", "project evidence is unavailable in this store connector")
      return read(project, request)
    },
  }).summary("find project-name and alias evidence in the existing local meeting index")
