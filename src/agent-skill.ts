import { annotate, customizeSharedCommand } from "@wirecat/cli-base/commands"
import { type SkillEnvironment, skillCommand } from "@wirecat/cli-base/skill"
import { grantsAuthority, LOCAL_WRITE, NO_EFFECTS, skillCommand as sharedSkillCommand } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { SHELL_OVERRIDES } from "./contract-overrides.js"
import { ZM } from "./read-only.js"
import { VERSION } from "./version.js"

const addZoomSkillCommandsDefinition = (
  program: Command,
  environment: SkillEnvironment,
  skill = new URL("../skills/zoom-cli/SKILL.md", import.meta.url),
): void => {
  const command = skillCommand({ command: "zm", appName: "zoom-cli", version: VERSION }, skill, environment)
  for (const child of command.commands) {
    if (child.name() === "install")
      annotate(grantsAuthority(child), { effects: LOCAL_WRITE, examples: ["zm skill install --for agents --json"] })
    if (child.name() === "show") annotate(child, { examples: ["zm skill show --json"] })
  }
  // addCommand, unlike command(), does not pass these down, and commander's defaults print plain text and exit 1.
  const inheritFailureHandling = (target: Command) => {
    target.exitOverride().configureOutput(program.configureOutput())
    for (const child of target.commands) inheritFailureHandling(child)
  }
  inheritFailureHandling(command)
  program.addCommand(annotate(command, { effects: NO_EFFECTS }))
}

export const addZoomSkillCommands = (...args: Parameters<typeof addZoomSkillCommandsDefinition>) => {
  customizeSharedCommand(
    sharedSkillCommand(ZM, new URL("../skills/zoom-cli/SKILL.md", import.meta.url)),
    "Zoom installs its own meeting instructions through its source renderer and treats the packaged primary skill as effect-free.",
    () => {
      addZoomSkillCommandsDefinition(...args)
      const command = args[0].commands.find((command) => command.name() === "skill")
      if (!command) throw new Error("skill builder did not install its command")
      return command
    },
    SHELL_OVERRIDES.skill,
  )
}
