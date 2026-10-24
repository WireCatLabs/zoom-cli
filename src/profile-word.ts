import { CliError } from "@wirecat/cli-base"
import { addProfile, readConfig } from "./config.js"

export const PROFILE_HELP =
  "The first word is the profile whenever it is not a command — `zm personal meetings list`.\n" +
  "`ZM_PROFILE` says the same thing for a whole shell session.\n" +
  "No profile is assumed: without one, a command that uses an account stops and lists the profiles here."

/**
 * Importing or syncing lists the profile it stores for. On a computer with no profile that makes the first one; beside
 * others an unknown name is refused before anything is stored, since it is far more often a typo than a new account —
 * a new one starts with its login.
 */
export const recordProfile = (configPath: string, profile: string): void => {
  const here = readConfig(configPath).profiles
  if (here.includes(profile)) return
  if (here.length)
    throw new CliError(
      "validation_error",
      `there is no profile ${profile} here — profiles here: ${here.join(", ")}. A new one starts with ` +
        `\`zm ${profile} session start\`; a typo stores nothing`,
      { profiles: here },
    )
  addProfile(configPath, profile)
}
