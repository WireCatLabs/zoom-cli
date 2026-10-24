import { CliError } from "@wirecat/cli-base"
import { annotate, describeOptions, describeProgram, flatten, metaOf } from "@wirecat/cli-base/commands"
import { formatSuggestions, suggest } from "@wirecat/cli-base/completion"
import { type Body, commandsCommand, itemOf, LOCAL_READ, NO_EFFECTS, REMOTE_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { wholeList } from "./answer-output.js"
import { ZM } from "./read-only.js"

export interface StandardCommandsDeps {
  output: (body: Body) => void
  raw: (text: string) => void
  doctor: () => unknown
  sessionStatus: (check: boolean) => Promise<unknown>
}
export const addStandardCommands = (program: Command, deps: StandardCommandsDeps): void => {
  program.addCommand(commandsCommand(ZM).copyInheritedSettings(program))
  annotate(
    program
      .command("complete")
      .description("answer shell completion requests")
      .argument("[words...]", "shell words ending in the partial word")
      .action((words: string[]) => {
        const suggestions = suggest({
          commands: describeProgram(program),
          globalOptions: describeOptions(program),
          words,
        })
        if (program.opts().json || program.opts().jsonl) deps.output(wholeList("complete", suggestions))
        else deps.raw(`${formatSuggestions(suggestions)}\n`)
      }),
    { effects: NO_EFFECTS, examples: ["zm complete -- meetings s"] },
  )
  annotate(
    program
      .command("doctor")
      .description("check local runtime and public config without a login or database")
      .action(() => deps.output(itemOf(deps.doctor()))),
    { effects: LOCAL_READ, examples: ["zm doctor --json"] },
  )
  const session = annotate(program.command("session"), { effects: NO_EFFECTS }).description(
    "the saved Zoom login, separate from local data profiles",
  )
  annotate(
    session
      .command("status")
      .description("show cached login state; remote verification is explicit")
      .option("--check", "verify the session with Zoom")
      .action(async (options: { check?: boolean }) =>
        deps.output(itemOf(await deps.sessionStatus(options.check === true))),
      ),
    {
      effects: REMOTE_READ,
      examples: ["zm personal session status --json", "zm personal session status --check --json"],
    },
  )
}

export const annotateMeetingCommands = (program: Command): void => {
  for (const item of flatten(describeProgram(program))) {
    let command = program
    for (const part of item.path) {
      const found = command.commands.find((child) => child.name() === part)
      if (found) command = found
    }
    if (command.commands.length) continue
    const path = item.path.join(" ")
    if (!metaOf(command).effects) throw new CliError("configuration_error", `command effects are missing: ${path}`)
    annotate(command, {
      origin: "handwritten",
      examples: item.examples?.map((example) =>
        PROFILE_FREE.has(item.path[0] ?? "") ? example : example.replace(`zm ${path}`, `zm personal ${path}`),
      ) ?? [exampleFor(path)],
    })
  }
}
/** The top-level commands that act for no account, so their examples carry no profile word. */
export const PROFILE_FREE = new Set([
  "commands",
  "complete",
  "config",
  "doctor",
  "guide",
  "help",
  "skill",
  "upgrade",
  "models",
])
const exampleFor = (path: string): string => {
  const profile = PROFILE_FREE.has(path.split(" ")[0] ?? "") ? "" : "personal "
  if (path === "mcp") return "zm personal mcp"
  if (path === "session start") return "zm personal session start"
  const argumentsByPath: Record<string, string> = {
    "commands info": "meetings list",
    "config set": "files.timezone Europe/Madrid",
    "meetings show": "1",
    "meetings transcript": "1",
    "meetings summary": "1",
    "meetings export": "1 --format markdown",
    "meetings people": '"Alice Example"',
    "meetings projects evidence": 'RES "identity_id:12"',
    "meetings import": "./downloaded-transcripts",
  }
  return `zm ${profile}${path}${argumentsByPath[path] ? ` ${argumentsByPath[path]}` : ""} --json`
}
