import { projectFields } from "@wirecat/cli-base"
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
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { VERSION } from "./version.js"

const CONTRACT = 2

export interface StandardCommandsDeps {
  output: (value: unknown) => void
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
          deps.discovery(
            flatten(commands).map(({ usage, summary, description, mutates }) => ({
              command: usage,
              description: summary ?? description,
              writes: mutates ? "yes" : "",
            })),
          )
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
    { mutates: false, examples: ["zm commands --json"] },
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
        if (program.opts().json || program.opts().jsonl) deps.output({ items: suggestions })
        else deps.raw(`${formatSuggestions(suggestions)}\n`)
      }),
    { mutates: false, examples: ["zm complete -- meetings s"] },
  )
  annotate(
    program
      .command("doctor")
      .description("check local runtime and public config without a login or database")
      .action(() => deps.output(deps.doctor())),
    { mutates: false, examples: ["zm doctor --json"] },
  )
  const session = program.command("session").description("the saved Zoom login, separate from local data profiles")
  annotate(
    session
      .command("status")
      .description("show cached login state; remote verification is explicit")
      .option("--check", "verify the session with Zoom")
      .action(async (options: { check?: boolean }) => deps.output(await deps.sessionStatus(options.check === true))),
    { mutates: false, examples: ["zm session status --json", "zm session status --check --json"] },
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
    const knownLocal = ["config set", "session start", "meetings sync", "meetings import", "meetings export"].includes(
      path,
    )
    const mutates = knownLocal || metaOf(command).mutates === true
    annotate(command, {
      origin: "handwritten",
      mutates,
      ...(knownLocal ? { local: true } : {}),
      ...(item.examples ? {} : { examples: [exampleFor(path)] }),
    })
  }
}
const exampleFor = (path: string): string => {
  if (path === "serve") return "zm serve --mcp"
  if (path === "session start") return "zm session start --interactive"
  const argumentsByPath: Record<string, string> = {
    "config set": "account.profile personal",
    "meetings show": "1",
    "meetings transcript": "1",
    "meetings summary": "1",
    "meetings export": "1 --format markdown",
    "meetings people": '"Alice Example"',
    "meetings projects evidence": 'RES "identity_id:12"',
    "meetings import": "./downloaded-transcripts",
  }
  return `zm ${path}${argumentsByPath[path] ? ` ${argumentsByPath[path]}` : ""} --json`
}

const scopeOf = (all: readonly CommandInfo[], path: readonly string[]) => {
  const inheritedOptions: { path: readonly string[]; options: CommandInfo["options"] }[] = []
  let available = all
  let command: CommandInfo | undefined
  for (const word of path) {
    if (command?.options.length) inheritedOptions.push({ path: command.path, options: command.options })
    command = available.find((item) => item.name === word)
    if (!command) throw new ZoomError("validation_error", "unknown command path; use zm commands --json")
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
    mutates: command.mutates,
    local: command.local,
    commands: projectDiscovery(command.commands, fields),
  }))
