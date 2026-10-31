import { CliError } from "@wirecat/cli-base"
import {
  appDoctorCommand,
  appMcpCommand,
  type Configuration,
  commandPermissions,
  type GlobalFlags,
  NONE_NAMED,
  type ProgramDefinition,
  type ResolveOptions,
  runSettings,
  run as sharedRun,
} from "@wirecat/cli-core/cli"
import { assertOverridesTighten, COMMAND_PATH_KEY, permissionOverrides } from "@wirecat/cli-core/sends"
import type { Command } from "commander"
import { zoomRunsCommand } from "./commands.js"
import { inspectConfig, readConfig } from "./config.js"
import { publicIssue } from "./config-issues.js"
import { ZOOM_FIRST_SCREEN } from "./first-screen.js"
import { DEFAULT_PERMISSIONS, discoveryLevels, permissionKeyForPath, permissionKeys } from "./permissions.js"
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

const PERMISSIONS = commandPermissions({ keyOf: permissionKeyForPath, defaults: DEFAULT_PERMISSIONS })
const SKILL = new URL("../skills/zoom-cli/SKILL.md", import.meta.url)

// The shared mcp and doctor commands read more of the settings than the program itself does.
const zoomConfiguration = (deps: ProgramDeps, program: () => Command | undefined) => ({
  permissionKey: permissionKeyForPath,
  permissions: PERMISSIONS,
  resolveSettings: (flags?: GlobalFlags, options?: ResolveOptions) => {
    const built = program()
    const known = built ? permissionKeys(built) : undefined
    const env = options?.env ?? deps.env ?? process.env
    const word = flags?.profile
    const profile = options?.needsProfile
      ? chooseProfile({ word, env, profiles: () => readConfig(deps.configPath, known).profiles })
      : (word ?? env.ZM_PROFILE ?? env.ZM_PROFILE_LOCK ?? "")
    const saved = configured(deps.configPath)
    const { keepFailedRuns, keepRunsForDays, keepSuccessfulRunsForDays } = runSettings(flags?.record, saved)
    const own = profile ? (readConfig(deps.configPath, known).permissions[profile] ?? {}) : {}
    const levels = discoveryLevels(own, env)
    const overrides = permissionOverrides(flags?.permission, COMMAND_PATH_KEY)
    assertOverridesTighten(overrides, levels, DEFAULT_PERMISSIONS)
    const inspected = options?.withIssues ? inspectConfig(deps.configPath, known) : undefined
    const profiles = inspected?.config.profiles ?? saved?.profiles ?? []
    return {
      profile,
      sources: { profile: profile ? (word === undefined ? "environment" : "first word") : NONE_NAMED },
      keepFailedRuns,
      keepRunsForDays,
      keepSuccessfulRunsForDays,
      ...(saved?.recordInput === undefined ? {} : { recordInput: saved.recordInput }),
      skillHint: false,
      permissions: profile ? { ...levels, ...overrides } : {},
      permissionSources: Object.fromEntries([
        ...Object.keys(own).map((key) => [key, "config file"]),
        ...Object.keys(overrides).map((key) => [key, "flag"]),
      ]),
      savedPermissions: Object.keys(own).map((key) => ({ key, at: ["profiles", profile, "permissions", key] })),
      configPath: deps.configPath,
      configFound: inspected?.found ?? saved !== undefined,
      configuredProfiles: profiles,
      profilesHere: profiles,
      ...(inspected ? { configIssues: inspected.issues.map(publicIssue) } : {}),
    }
  },
})

export const zoomDefinition = (deps: ProgramDeps, onFailure?: (error: unknown) => void): ProgramDefinition => {
  const lifecycles = new WeakMap<Command, ZoomLifecycle>()
  let built: Command | undefined
  const configuration = zoomConfiguration(deps, () => built)
  // The shared commands type their settings as cli-core's own `settingsFor` result, which zoom's file does not use.
  const shared = configuration as unknown as Configuration
  return {
    app: ZM,
    commands: () => [
      zoomRunsCommand(),
      appDoctorCommand(ZM, shared, {
        oauthClient: () => {
          if (!configured(deps.configPath)?.clientId)
            throw new CliError("configuration_error", "zoom.client_id is not set")
          return { client: "own" }
        },
      }),
      appMcpCommand(ZM, shared, {
        name: "Zoom",
        untrusted: ["transcripts", "summaries", "chat messages", "participant names", "meeting titles", "file names"],
        permissionExample: "remote-meetings=deny",
        skill: SKILL,
      }),
    ],
    firstScreen: ZOOM_FIRST_SCREEN,
    configuration,
    configure: (program) => {
      built = program
      const lifecycle: ZoomLifecycle = {}
      lifecycles.set(program, lifecycle)
      bindZoomProgram(program, deps, lifecycle)
    },
    prepare: (program) => lifecycles.get(program)?.prepare?.(),
    onFailure: async (error, program) => {
      await lifecycles.get(program)?.fail?.(error)
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
    ...(deps.stdin ? { stdin: deps.stdin } : {}),
    ...(deps.stdout ? { stdout: deps.stdout } : {}),
    keyring: deps.tokens.options.keyring,
    ...(deps.confirm ? { answer: async (question: string) => ((await deps.confirm?.(question)) ? "yes" : "no") } : {}),
  })
