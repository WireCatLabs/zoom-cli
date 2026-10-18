import { annotate } from "@wirecat/cli-base/commands"
import { type SkillEnvironment, skillCommand } from "@wirecat/cli-base/skill"
import { LOCAL_READ, LOCAL_WRITE, NO_EFFECTS } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { VERSION } from "./version.js"

export const addZoomSkillCommands = (
  program: Command,
  environment: SkillEnvironment,
  skill = new URL("../skills/zoom-cli/SKILL.md", import.meta.url),
): void => {
  const command = skillCommand({ command: "zm", appName: "zoom-cli", version: VERSION }, skill, environment)
  for (const child of command.commands) {
    const install = child.name() === "install"
    annotate(child, {
      effects: install ? LOCAL_WRITE : LOCAL_READ,
      examples: [install ? "zm skill install --for agents --json" : "zm skill show --json"],
    })
  }
  // addCommand, unlike command(), does not pass these down, and commander's defaults print plain text and exit 1.
  const inheritFailureHandling = (target: Command) => {
    target.exitOverride().configureOutput(program.configureOutput())
    for (const child of target.commands) inheritFailureHandling(child)
  }
  inheritFailureHandling(command)
  program.addCommand(annotate(command, { effects: NO_EFFECTS }))
}
