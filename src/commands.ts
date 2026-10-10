import { annotate, describeOptions, describeProgram, flatten, metaOf } from "@wirecat/cli-core/commands"
import { formatSuggestions, suggest } from "@wirecat/cli-core/completion"
import type { Command } from "commander"

export interface StandardCommandsDeps {
  output: (value: unknown) => void
  raw: (text: string) => void
  doctor: () => unknown
  sessionStatus: (check: boolean) => Promise<unknown>
}
export const addStandardCommands = (program: Command, deps: StandardCommandsDeps): void => {
  annotate(
    program
      .command("commands")
      .description("discover commands, flags and examples")
      .action(() => {
        deps.output({ commands: describeProgram(program), options: describeOptions(program) })
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
  const session = program
    .command("session")
    .description("inspect the saved OAuth session separately from local data profiles")
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
    const knownLocal = ["config set", "login", "pull", "import"].includes(path)
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
  const argumentsByPath: Record<string, string> = {
    "config set": "account.profile personal",
    "meetings show": "1",
    "meetings transcript": "1",
    "meetings search": '"example plan"',
    "meetings people": '"Alice Example"',
    import: "./downloaded-transcripts",
  }
  return `zm ${path}${argumentsByPath[path] ? ` ${argumentsByPath[path]}` : ""} --json`
}
