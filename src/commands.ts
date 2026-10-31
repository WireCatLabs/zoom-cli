import { CliError } from "@wirecat/cli-base"
import { annotate, describeOptions, describeProgram, flatten, metaOf } from "@wirecat/cli-base/commands"
import { formatSuggestions, suggest } from "@wirecat/cli-base/completion"
import {
  type Body,
  commandsCommand,
  hasSharedContract,
  itemOf,
  NO_EFFECTS,
  overrideSharedContract,
  profileFree,
  REMOTE_READ,
  runsCommand,
  sharedStoreCommand,
} from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { wholeList } from "./answer-output.js"
import { ZM } from "./read-only.js"

export interface StandardCommandsDeps {
  output: (body: Body) => void
  raw: (text: string) => void
  sessionStatus: (check: boolean) => Promise<unknown>
}
const addStandardCommandsDefinition = (program: Command, deps: StandardCommandsDeps): void => {
  program.addCommand(commandsCommand(ZM).copyInheritedSettings(program))
  program.addCommand(sharedStoreCommand().copyInheritedSettings(program))
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
      examples: ["zm personal session status --json", "zm personal session status --check --dry-run --json"],
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
    const examples = item.examples?.map((example) =>
      PROFILE_FREE.has(item.path[0] ?? "") ? example : example.replace(`zm ${path}`, `zm personal ${path}`),
    ) ?? [exampleFor(path)]
    if (JSON.stringify(examples) === JSON.stringify(item.examples)) continue
    const change = (one: Command) => {
      annotate(one, { examples })
    }
    if (hasSharedContract(command))
      overrideSharedContract(
        command,
        "Zoom account examples explicitly name the personal profile required for meeting reads.",
        change,
      )
    else change(command)
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
  "runs",
])

/** Help then shows these without a profile: `zm doctor`, not `zm personal doctor`. */
export const markProfileFree = (program: Command): void => {
  for (const command of program.commands) if (PROFILE_FREE.has(command.name())) profileFree(command)
}

/** cli-core's `runs`, read without a profile: one log per computer, whatever profile a run was for. */
export const zoomRunsCommand = (): Command => {
  const runs = runsCommand(ZM)
  overrideSharedContract(
    runs,
    "Zoom declares effects on every command group, the shared run log's included.",
    (group) => {
      annotate(group, { effects: NO_EFFECTS })
    },
  )
  return runs
}
const exampleFor = (path: string): string => {
  const profile = PROFILE_FREE.has(path.split(" ")[0] ?? "") ? "" : "personal "
  if (path === "mcp serve") return "zm personal mcp serve"
  if (path === "session start") return "zm personal session start"
  const argumentsByPath: Record<string, string> = {
    "commands info": "meetings list",
    "config set": "files.timezone Europe/Madrid",
    "meetings sync": "--dry-run",
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

export const addStandardCommands = addStandardCommandsDefinition
