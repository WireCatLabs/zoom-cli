import { CliError, projectFields } from "@wirecat/cli-base"
import {
  annotate,
  type CommandInfo,
  commandsDocument,
  describeOptions,
  describeProgram,
  flatten,
  metaOf,
} from "@wirecat/cli-base/commands"
import { formatSuggestions, suggest } from "@wirecat/cli-base/completion"
import { type Body, commandsText, itemOf, LOCAL_READ, NO_EFFECTS, REMOTE_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { wholeList } from "./answer-output.js"
import { VERSION } from "./version.js"

const CONTRACT = 3

export interface StandardCommandsDeps {
  output: (body: Body) => void
  discovery: (value: unknown) => void
  fields: () => readonly string[] | undefined
  raw: (text: string) => void
  doctor: () => unknown
  sessionStatus: (check: boolean) => Promise<unknown>
}
export const addStandardCommands = (program: Command, deps: StandardCommandsDeps): void => {
  annotate(
    program
      .command("commands")
      .description("discover commands, flags and examples, optionally scoped to a command path")
      .argument("[path...]", "resource or command path")
      .action((path: string[]) => {
        const all = describeProgram(program)
        const scoped = path.length ? scopeOf(all, path) : undefined
        const commands = scoped ? [scoped.command] : all
        if (!program.opts().json && !program.opts().jsonl) {
          deps.raw(commandsText(program, commands, scoped?.command.path))
          return
        }
        const fields = deps.fields()
        const { exit_codes, ...document } = commandsDocument(program, {
          cli: "zm",
          version: VERSION,
          contract: CONTRACT,
        })
        deps.discovery({
          ...document,
          ...(scoped ? { scope: scoped.command.path, inherited_options: scoped.inheritedOptions } : {}),
          commands: fields ? projectDiscovery(commands, fields) : commands,
          exit_codes,
        })
      }),
    { effects: NO_EFFECTS, examples: ["zm commands --json"] },
  )
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
    { effects: REMOTE_READ, examples: ["zm session status --json", "zm session status --check --json"] },
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
    annotate(command, { origin: "handwritten", ...(item.examples ? {} : { examples: [exampleFor(path)] }) })
  }
}
/** The top-level commands that act for no account, so their examples carry no profile word. */
export const PROFILE_FREE = new Set(["commands", "complete", "config", "doctor", "guide", "help", "skill"])
const exampleFor = (path: string): string => {
  const profile = PROFILE_FREE.has(path.split(" ")[0] ?? "") ? "" : "personal "
  if (path === "serve") return "zm personal serve --mcp"
  if (path === "session start") return "zm personal session start"
  const argumentsByPath: Record<string, string> = {
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

const scopeOf = (all: readonly CommandInfo[], path: readonly string[]) => {
  const inheritedOptions: { path: readonly string[]; options: CommandInfo["options"] }[] = []
  let available = all
  let command: CommandInfo | undefined
  for (const word of path) {
    if (command?.options.length) inheritedOptions.push({ path: command.path, options: command.options })
    command = available.find((item) => item.name === word)
    if (!command) throw new CliError("validation_error", "unknown command path; use zm commands --json")
    available = command.commands
  }
  return { command: command as CommandInfo, inheritedOptions }
}

const projectDiscovery = (commands: readonly CommandInfo[], fields: readonly string[]): unknown[] =>
  commands.map((command) => ({
    ...(projectFields(command, fields) as Record<string, unknown>),
    path: command.path,
    name: command.name,
    origin: command.origin,
    effects: command.effects,
    commands: projectDiscovery(command.commands, fields),
  }))
