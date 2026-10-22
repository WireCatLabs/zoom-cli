import { commandWords, liftProfile } from "@wirecat/cli-core/cli"
import { type Command, Help } from "commander"
import { PROFILE_FREE } from "./commands.js"
import { addProfile, readConfig } from "./config.js"
import { chooseProfile } from "./profile.js"

export const PROFILE_HELP =
  "The first word is the profile whenever it is not a command — `zm personal meetings list`.\n" +
  "`ZM_PROFILE` says the same thing for a whole shell session.\n" +
  "No profile is assumed: without one, a command that uses an account stops and lists the profiles here."

/** The root options that take the next word as their value, so `zm --timeout 30s personal …` finds the profile. */
const valuedOptions = (program: Command): Set<string> =>
  new Set(
    program.options
      .filter((option) => option.required)
      .flatMap((option) => [option.long, option.short].filter((flag): flag is string => flag !== undefined)),
  )

/** Takes the profile word off the command line, in Commander's `parseAsync` argument shape. */
export const liftProfileWord = (
  program: Command,
  [argv = process.argv, settings]: Parameters<Command["parseAsync"]>,
): { profile?: string; args: Parameters<Command["parseAsync"]> } => {
  const head = settings?.from === "user" ? [] : argv.slice(0, 2)
  const named = liftProfile(argv.slice(head.length), commandWords(program), valuedOptions(program))
  return { profile: named.profile, args: [[...head, ...named.rest], settings] }
}

/** Commander builds a usage line from the command tree, where the profile is not a word. */
export const showProfileInUsage = (program: Command): void => {
  const withProfile = (command: Command) => {
    command.configureHelp({
      ...command.configureHelp(),
      commandUsage: (shown) => `zm <profile>${new Help().commandUsage(shown).slice("zm".length)}`,
    })
    for (const child of command.commands) withProfile(child)
  }
  for (const top of program.commands) if (!PROFILE_FREE.has(top.name())) withProfile(top)
}

/** One parse's profile: `lift` takes the word off the command line, `profile()` resolves it when a command needs it. */
export const profileSelection = (env: NodeJS.ProcessEnv, profiles: () => readonly string[]) => {
  let word: string | undefined
  let chosen: string | undefined
  const profile = (): string => {
    chosen ??= chooseProfile({ word, env, profiles })
    return chosen
  }
  return {
    lift: (program: Command, args: Parameters<Command["parseAsync"]>): Parameters<Command["parseAsync"]> => {
      const named = liftProfileWord(program, args)
      word = named.profile
      chosen = undefined
      return named.args
    },
    profile,
    /** The profile when one is named, by word or environment; undefined instead of the error that lists them. */
    named: (): string | undefined =>
      word !== undefined || env.ZM_PROFILE?.trim() || env.ZM_PROFILE_LOCK?.trim() ? profile() : undefined,
  }
}

/** A profile is listed once something is stored for it; a new one beside others is said, since it may be a typo. */
export const recordProfile = (configPath: string, profile: string, diagnostic?: (text: string) => void): void => {
  const here = readConfig(configPath).profiles
  if (here.includes(profile)) return
  if (here.length) diagnostic?.(`new profile ${profile}; the other profiles here: ${here.join(", ")}\n`)
  addProfile(configPath, profile)
}
