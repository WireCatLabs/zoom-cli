import { CliError } from "@wirecat/cli-base"
import { usableProfileName } from "@wirecat/cli-core/cli"

export const profilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const profileAccountKey = (profile: string): string => `zm-profile:${profile}`

const given = (value: string | undefined): string | undefined => (value?.trim() ? value.trim() : undefined)

const usable = (profile: string): string => {
  usableProfileName(profile)
  if (!profilePattern.test(profile))
    throw new CliError("validation_error", `"${profile}" cannot be a profile name — 64 characters at most`)
  return profile
}

export interface ProfileChoice {
  /** The first word on the command line, when it was not a command. */
  word?: string
  env: NodeJS.ProcessEnv
  /** Only to list in the error when none is named, so a named profile never reads the config. */
  profiles: () => readonly string[]
}

/**
 * The profile a command acts for: the first word, else `ZM_PROFILE`, else `ZM_PROFILE_LOCK`. Nothing else
 * picks one — not a saved setting, not the only profile here.
 */
export const chooseProfile = ({ word, env, profiles }: ProfileChoice): string => {
  const lock = given(env.ZM_PROFILE_LOCK)
  const named = word !== undefined ? word : given(env.ZM_PROFILE)
  if (lock !== undefined) usable(lock)
  if (named !== undefined && lock !== undefined && named !== lock)
    throw new CliError(
      "permission_error",
      `this process is locked to profile ${lock} (ZM_PROFILE_LOCK) — profile ${named} is refused`,
    )
  const profile = named ?? lock
  if (profile === undefined) {
    const here = profiles()
    throw new CliError(
      "validation_error",
      here.length === 0
        ? "name a profile: there is none on this computer yet — create one with `zm personal session start` " +
            "(any name in place of personal)"
        : `name a profile: \`zm <profile> …\` — profiles here: ${here.join(", ")} (or set ZM_PROFILE)`,
      { profiles: [...here] },
    )
  }
  return usable(profile)
}
