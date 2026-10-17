import { addMeetingPreparationCommand } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import type { ContextCapture } from "./meeting-communications-binding.js"
import {
  createZoomPreparationReader,
  type PreparationConnection,
  type ZoomPreparationOptions,
} from "./meeting-preparation.js"
import { addProjectEvidenceCommand } from "./meeting-project-evidence-commands.js"

export const addMeetingReadBindings = (
  program: Command,
  deps: {
    project: Parameters<typeof addProjectEvidenceCommand>[1]
    preparation: ZoomPreparationOptions & { connect: (context?: ContextCapture) => Promise<PreparationConnection> }
  },
) => {
  addProjectEvidenceCommand(program, deps.project)
  addMeetingPreparationCommand(program, {
    communications: true,
    read: createZoomPreparationReader(deps.preparation),
    signal: deps.project.signal,
    now: deps.project.now,
    output: deps.project.output,
  })
}
