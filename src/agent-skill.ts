import { annotate } from "@wirecat/cli-base/commands"
import { type SkillEnvironment, skillCommand } from "@wirecat/cli-base/skill"
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
      mutates: install,
      ...(install ? { local: true } : {}),
      examples: [install ? "zm skill install --for agents --json" : "zm skill show --json"],
    })
  }
  program.addCommand(command)
}
