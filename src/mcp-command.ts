import { CliError } from "@wirecat/cli-base"
import { annotate, customizeSharedCommand, describeProgram } from "@wirecat/cli-base/commands"
import { changesAuthorityAt, FETCH, NO_EFFECTS, type RunOptions, sharedCommandTemplate } from "@wirecat/cli-core/cli"
import type { Level } from "@wirecat/cli-core/sends"
import type { Command } from "commander"
import { SHELL_OVERRIDES } from "./contract-overrides.js"
import type { RunCommand, ZoomMcpOptions } from "./mcp.js"
import type { ProgramDeps } from "./program.js"
import { ZM } from "./read-only.js"

export interface McpCommandDeps {
  profile: () => string
  permissions: (profile: string) => Readonly<Record<string, Level>>
  run: RunCommand
  signal: () => AbortSignal | undefined
  serve?: (options: ZoomMcpOptions) => Promise<void>
}

/** `zm <profile> mcp`: the shared three-tool MCP server over stdio, for the named profile (WC-CMD-5, WC-MCP-9). */
const addMcpCommandsDefinition = (program: Command, deps: McpCommandDeps): void => {
  annotate(program.command("mcp"), {
    effects: FETCH,
    lifetime: "persistent",
    mcp: false,
    examples: ["zm personal mcp"],
  })
    .description("serve zm's commands to an MCP agent over stdio, as the named profile allows them")
    .action(async () => {
      const opts = program.opts()
      if (opts.json || opts.jsonl)
        throw new CliError("validation_error", "MCP stdio controls its own output; omit --json and --jsonl")
      const profile = deps.profile()
      const serve = deps.serve ?? (await import("./mcp.js")).serveZoomMcp
      await serve({
        profile,
        commands: describeProgram(program),
        authority: changesAuthorityAt(program),
        permissions: () => deps.permissions(profile),
        run: deps.run,
        ...(deps.signal() ? { signal: deps.signal() as AbortSignal } : {}),
      })
    })
  annotate(program.command("serve", { hidden: true }), { effects: NO_EFFECTS, mcp: false })
    .description("moved: zm <profile> mcp")
    .allowUnknownOption()
    .allowExcessArguments()
    .action(() => {
      throw new CliError(
        "validation_error",
        "`zm serve --mcp` is now `zm <profile> mcp`: one server with zm_tools_search, zm_read and zm_write; " +
          "the profile's permissions decide what it offers, in place of the serve flags",
      )
    })
}

/** A run for an MCP agent: the answer and the error captured, nothing at a terminal, and `ask` taken as yes. */
export const runForAgent = async (
  run: (argv: string[], deps: ProgramDeps) => Promise<number>,
  argv: string[],
  deps: ProgramDeps,
  environment?: RunOptions,
) => {
  const stdout: string[] = []
  const stderr: string[] = []
  const { serveMcp: _serve, streamData: _stream, ...rest } = deps
  const code = await run(argv, {
    ...rest,
    ...(environment?.agent
      ? {
          agent: {
            ...environment.agent,
            result: (value: unknown) => stdout.push(JSON.stringify(value)),
            failure: (value: unknown) => stderr.push(JSON.stringify(value)),
          },
        }
      : {}),
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
    outputIsTTY: false,
    confirm: async () => true,
  })
  return { code, stdout: stdout.join(""), stderr: stderr.join("") }
}

export const addMcpCommands = (...args: Parameters<typeof addMcpCommandsDefinition>) =>
  customizeSharedCommand(
    sharedCommandTemplate(ZM, "mcp"),
    "Zoom serves meeting and archive commands over stdio under its selected profile; HTTP-specific options are unsupported.",
    () => {
      addMcpCommandsDefinition(...args)
      const command = args[0].commands.find((command) => command.name() === "mcp")
      if (!command) throw new Error("mcp builder did not install its command")
      return command
    },
    SHELL_OVERRIDES.mcp,
  )
