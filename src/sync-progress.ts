import { CliError } from "@wirecat/cli-base"
import { checkpointPath, progressOf, readCheckpoint, saveCheckpoint } from "@wirecat/cli-core/background"
import type { RunReport } from "@wirecat/cli-core/meetings"
import { zmPaths } from "./folders.js"

export const meetingProgress = (profile: string, env: NodeJS.ProcessEnv, now: () => number = Date.now) => {
  const path = checkpointPath(zmPaths({ env }).state, profile, "meetings")
  return {
    begin: () => saveCheckpoint(path, { cursor: { complete: false }, done: 0 }, new Date(now())),
    complete: (report: RunReport) =>
      saveCheckpoint(
        path,
        {
          cursor: { complete: report.warnings.length === 0 },
          done: report.meetings,
        },
        new Date(now()),
      ),
    read: () => {
      const saved = readCheckpoint<{ complete: boolean }>(path)
      if (
        saved &&
        (!Number.isSafeInteger(saved.done) ||
          saved.done < 0 ||
          typeof saved.cursor?.complete !== "boolean" ||
          !Number.isFinite(Date.parse(saved.updated_at)))
      )
        throw new CliError("configuration_error", "the saved meeting progress is invalid; run a sync to replace it")
      return progressOf({
        job: "meetings",
        profile,
        done: saved?.done ?? 0,
        complete: saved?.cursor.complete ?? false,
        updatedAt: saved?.updated_at,
        now: new Date(now()),
      })
    },
  }
}
