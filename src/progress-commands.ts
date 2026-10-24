import { join } from "node:path"
import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { progressOf } from "@wirecat/cli-core/background"
import { type Body, itemOf, LOCAL_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { profileAccountKey } from "./config.js"
import { inspectRecordingSyncCheckpoint } from "./recording-sync-store.js"
import { meetingProgress } from "./sync-progress.js"

export const addProgressCommands = (
  program: Command,
  deps: {
    profile: () => string
    env: NodeJS.ProcessEnv
    now?: () => number
    output: (body: Body) => void
  },
) => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  const recordings = program.commands.find((command) => command.name() === "recordings")
  if (!meetings || !recordings) throw new CliError("configuration_error", "the meeting command groups are missing")
  annotate(meetings.command("status"), {
    effects: LOCAL_READ,
    output: { entity: "sync_progress" },
    examples: ["zm personal meetings status --json"],
  })
    .description("the last meeting ingestion pass: confirmed count, completion and checkpoint age")
    .action(() => deps.output(itemOf(meetingProgress(deps.profile(), deps.env, deps.now).read())))
  annotate(recordings.command("status"), {
    effects: LOCAL_READ,
    output: { entity: "sync_progress" },
    examples: ["zm personal recordings status ./zoom-archive --json"],
  })
    .description("confirmed archived assets and pending discovery in one archive checkpoint")
    .argument("<directory>", "archive folder")
    .option("--checkpoint <file>", "an explicit archive checkpoint path")
    .action(async (directory: string, options: { checkpoint?: string }) => {
      const profile = deps.profile()
      const saved = await inspectRecordingSyncCheckpoint(
        options.checkpoint ?? join(directory, ".zoom-archive-sync.json"),
      )
      if (saved && (saved.scope.provider !== "zoom" || saved.scope.account !== profileAccountKey(profile)))
        throw new CliError("permission_error", "the archive checkpoint belongs to another profile")
      const done = saved?.entries.reduce((sum, entry) => sum + entry.acknowledged.length, 0) ?? 0
      const total =
        saved?.pendingWindows.length === 0
          ? saved.entries.reduce((sum, entry) => sum + entry.assets.length, 0)
          : undefined
      deps.output(
        itemOf(
          progressOf({
            job: "recordings",
            profile,
            done,
            total,
            complete: total !== undefined && done === total,
            updatedAt: saved ? new Date(saved.updatedAt).toISOString() : undefined,
            now: new Date(deps.now?.() ?? Date.now()),
          }),
        ),
      )
    })
}
