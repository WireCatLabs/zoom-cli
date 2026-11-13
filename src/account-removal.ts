import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { type AccountRemoval, accountRemoveCommand } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { zmPaths } from "./folders.js"
import { profileAccountKey } from "./profile.js"
import type { ProgramDeps } from "./program.js"
import { ZM } from "./read-only.js"

/** The file of an archive schedule that still runs for the profile; its timer belongs to `schedule disable`. */
const activeSchedule = (configPath: string, profile: string): string | undefined => {
  const directory = join(dirname(configPath), "recording-schedules")
  let names: string[]
  try {
    names = readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
  } catch {
    return undefined
  }
  return names.find((name) => {
    try {
      const job: { capture?: { profile?: unknown }; state?: unknown } = JSON.parse(
        readFileSync(join(directory, name), "utf8"),
      )
      return job.capture?.profile === profile && job.state !== "disabled"
    } catch {
      return false
    }
  })
}

export const zoomRemoval = ({ configPath, tokens }: Pick<ProgramDeps, "configPath" | "tokens">): AccountRemoval => ({
  signOut: async (profile) => ({
    revoked: null,
    removed: tokens.forProfile(profile).remove() ? ["the Zoom login"] : [],
  }),
  account: (profile) => ({ provider: "zoom", account: profileAccountKey(profile) }),
  stateFiles: (profile, { env }) => [join(zmPaths({ env }).state, "checkpoints", profile)],
  busy: (profile) => {
    const file = activeSchedule(configPath, profile)
    return (
      file &&
      `an archive schedule (turn it off with \`zm ${profile} recordings schedule disable ${file.slice(0, -5)}\`)`
    )
  },
})

export const zoomAccountRemoveCommand = (deps: Pick<ProgramDeps, "configPath" | "tokens">): Command =>
  accountRemoveCommand(ZM, zoomRemoval(deps))
