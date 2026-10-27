import { NONE_NAMED, type ProgramDefinition, runSettings, run as sharedRun } from "@wirecat/cli-core/cli"
import { zoomRunsCommand } from "./commands.js"
import { readConfig } from "./config.js"
import { ZOOM_FIRST_SCREEN } from "./first-screen.js"
import { discoveryLevels, permissionKeyForPath } from "./permissions.js"
import { chooseProfile } from "./profile.js"
import type { ProgramDeps } from "./program.js"
import { bindZoomProgram } from "./program-bindings.js"
import { ZM } from "./read-only.js"

export interface ZoomLifecycle {
  prepare?: () => Promise<void>
  fail?: (error: unknown) => Promise<void>
}

const configured = (path: string) => {
  try {
    return readConfig(path)
  } catch {
    return undefined
  }
}

export const zoomDefinition = (deps: ProgramDeps, onFailure?: (error: unknown) => void): ProgramDefinition => {
  const lifecycle: ZoomLifecycle = {}
  return {
    app: ZM,
    commands: () => [zoomRunsCommand()],
    firstScreen: ZOOM_FIRST_SCREEN,
    configuration: {
      permissionKey: permissionKeyForPath,
      resolveSettings: (flags, options) => {
        const env = options?.env ?? deps.env ?? process.env
        const word = flags?.profile
        const profile = options?.needsProfile
          ? chooseProfile({ word, env, profiles: () => readConfig(deps.configPath).profiles })
          : (word ?? env.ZM_PROFILE ?? env.ZM_PROFILE_LOCK ?? "")
        const { keepFailedRuns, keepRunsForDays, keepSuccessfulRunsForDays } = runSettings(
          flags?.record,
          configured(deps.configPath),
        )
        return {
          profile,
          ...(profile ? {} : { sources: { profile: NONE_NAMED } }),
          keepFailedRuns,
          keepRunsForDays,
          keepSuccessfulRunsForDays,
          skillHint: false,
          ...(profile
            ? { permissions: discoveryLevels(readConfig(deps.configPath).permissions[profile] ?? {}, env) }
            : {}),
        }
      },
    },
    configure: (program) => bindZoomProgram(program, deps, lifecycle, runCommand),
    prepare: () => lifecycle.prepare?.(),
    onFailure: async (error) => {
      await lifecycle.fail?.(error)
      onFailure?.(error)
    },
  }
}

export const runCommand = async (
  args: string[],
  deps: ProgramDeps,
  onFailure?: (error: unknown) => void,
): Promise<number> =>
  sharedRun(args, zoomDefinition(deps, onFailure), {
    streams: {
      data: (text) => deps.data(`${text}\n`),
      diagnostic: (text) => deps.diagnostic(`${text}\n`),
    },
    tty: deps.outputIsTTY ?? false,
    env: deps.env ?? process.env,
    signal: deps.signal,
    agent: deps.agent,
    keyring: deps.tokens.options.keyring,
    ...(deps.confirm ? { answer: async (question: string) => ((await deps.confirm?.(question)) ? "yes" : "no") } : {}),
  })
