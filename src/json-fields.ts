import { fieldsOf } from "@wirecat/cli-base"
import { liftJson } from "@wirecat/cli-core/cli"
import type { Command } from "commander"

const commandIn = (root: Command, words: readonly string[]): Command | undefined => {
  let at = root
  for (const word of words) {
    if (word.startsWith("-")) continue
    const child = at.commands.find((command) => command.name() === word || command.aliases().includes(word))
    if (child) at = child
  }
  return at === root ? undefined : at
}

/** `--json=a,b` or `--json a,b`, read the way tg and max read it: the arguments Commander parses, and the fields. */
export const liftJsonFields = (
  program: Command,
  [argv = process.argv, settings]: Parameters<Command["parseAsync"]>,
): { args: Parameters<Command["parseAsync"]>; fields: string[] | undefined } => {
  const user = settings?.from === "user"
  const requested = liftJson(user ? [...argv] : argv.slice(2), (words) => commandIn(program, words))
  return {
    args: [user ? requested.argv : [...argv.slice(0, 2), ...requested.argv], settings],
    fields: requested.fields === undefined ? undefined : fieldsOf(requested.fields),
  }
}
