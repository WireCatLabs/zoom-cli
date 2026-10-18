import { fileURLToPath } from "node:url"
import { guideCommand, installHelp } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { ZM } from "./read-only.js"

/** After every other command: the first screen's pointers name only commands that exist. */
export const installFirstScreen = (program: Command): void => {
  program.addCommand(
    guideCommand(ZM, {
      directory: fileURLToPath(new URL("../scenarios", import.meta.url)),
      worksWith: [{ tool: "memo", name: "person-brief", title: "One person across every tool" }],
      profile: false,
    }),
  )
  installHelp(program, {
    pitch:
      "your Zoom meetings for agents: transcripts and summaries in a local store, every answer pointing at its line.",
    can: [
      { command: "meetings sync", does: "meetings, transcripts and summaries into the store" },
      { command: 'search meetings "quote"', does: "words across every transcript, with line refs" },
      { command: "meetings context <person>", does: "what past meetings say about one person" },
      { command: "meetings prepare <series-id>", does: "a briefing with sources before a meeting" },
      { command: "meetings transcribe <meeting> <file>", does: "a recording turned into text on this machine" },
      { command: "recordings schedule create …", does: "a daily, checked archive of cloud recordings" },
      { command: "serve --mcp", does: "read-only meeting tools for any MCP agent" },
      { command: "ZM_READ_ONLY=1 zm …", does: "a run that changes nothing" },
    ],
    profile: false,
    start: "zm session start",
  })
}
