import { fileURLToPath } from "node:url"
import { guideCommand, type HelpSection, inSection, MEMO_SCENARIOS } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { ZM } from "./read-only.js"

// cli-core places its own groups (meetings, search, watch, serve, config, skill…); these are zm's.
const SECTIONS: [string[], HelpSection][] = [
  [["events"], "read"],
  [["recordings"], "read"],
  [["recordings", "schedule"], "automate"],
  [["remote-meetings"], "read"],
  [["remote-meetings", "create"], "write"],
  [["remote-meetings", "update"], "write"],
  [["remote-meetings", "cancel"], "write"],
  [["meetings", "transcribe"], "write"],
  [["meetings", "update"], "organise"],
  [["meetings", "link"], "organise"],
  [["batch"], "read"],
  [["session"], "setup"],
]

const placeInSections = (program: Command): void => {
  for (const [path, section] of SECTIONS) {
    let command: Command | undefined = program
    for (const name of path) command = command?.commands.find((child) => child.name() === name)
    if (!command) throw new Error(`no command to place in a section: ${path.join(" ")}`)
    inSection(command, section)
  }
}

/** After every other command: the first screen's pointers name only commands that exist. */
export const installFirstScreen = (program: Command): void => {
  placeInSections(program)
  const guide = guideCommand(ZM, {
    directory: fileURLToPath(new URL("../scenarios", import.meta.url)),
    worksWith: [MEMO_SCENARIOS.personBrief],
    profile: true,
  })
  // addCommand, unlike command(), leaves out the exit override: `guide --help` called process.exit itself.
  program.addCommand(guide.copyInheritedSettings(program))
}

export const ZOOM_FIRST_SCREEN = {
  pitch:
    "your Zoom meetings for agents: transcripts and summaries in a local store, every answer pointing at its line.",
  can: [
    { command: "meetings sync", does: "meetings, transcripts and summaries into the store" },
    { command: 'search meetings "quote"', does: "words across every transcript, with line refs" },
    { command: "meetings context <person>", does: "what past meetings say about one person" },
    { command: "meetings prepare <series-id>", does: "a briefing with sources before a meeting" },
    { command: "meetings transcribe <meeting> <file>", does: "a recording turned into text on this machine" },
    { command: "recordings schedule create …", does: "a daily, checked archive of cloud recordings" },
    { command: "mcp", does: "commands for an MCP agent, limited by the profile’s permissions" },
    {
      command: "ZM_READ_ONLY=1 zm …",
      does: "blocks changes to Zoom, login, settings, files and the store; syncs run",
    },
  ],
  start: "zm personal session start",
}
