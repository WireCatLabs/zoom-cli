import { readFileSync, writeFileSync } from "node:fs"
import { COMMANDS_PAGE_LABELS, commandsPage, describeOptions, describeProgram } from "@wirecat/cli-core/commands"
import { createProgram } from "./command-program.ts"

const program = createProgram()
const page = commandsPage({
  cli: "zm",
  commands: describeProgram(program),
  options: describeOptions(program),
  labels: COMMANDS_PAGE_LABELS.en,
  text: {
    banner: "<!-- Generated from the command tree by scripts/commands.ts. Do not edit; run pnpm generate. -->",
    title: "Commands",
    intro:
      "Command descriptions and options come from the installed program's command tree. Stored meeting ids differ from remote Zoom ids. Archive paths are explicit local directories.",
    globalHeading: "Global options",
    globalIntro: "These options apply to every command.",
    mutates: "**Changes remote Zoom data.**",
    mutatesLocal: "**Changes local data.**",
    exitHeading: "Exit codes",
    exitIntro: "Use the shared exit code rather than matching diagnostic text.",
    outro:
      "Remote meeting changes preview by default. Exit code 14 reports an uncertain dispatched outcome; inspect the remote state before retrying. Foreground watches require JSONL when output is piped.",
  },
})
const destination = new URL("../docs/commands.md", import.meta.url)
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== page) throw new Error("Command documentation is stale; run pnpm generate")
} else writeFileSync(destination, page)
