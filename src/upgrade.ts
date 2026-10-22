import { join } from "node:path"
import { createRenderer } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { FETCH, upgradeCommand } from "@wirecat/cli-core/cli"
import { appUpdate } from "@wirecat/cli-core/update"
import type { Command } from "commander"
import { zmPaths } from "./folders.js"
import { ZM } from "./read-only.js"
import { VERSION } from "./version.js"

const { installer, latest, runUpdate } = appUpdate({
  packageName: "@wirecat/zoom-cli",
  command: "zm",
  version: VERSION,
  entry: import.meta.url,
  statePath: (env) => join(zmPaths({ env }).state, "update-check.json"),
  enabled: () => true,
  offVariables: ["ZM_NO_UPDATE_CHECK"],
})

/** cli-core's `upgrade`: the package manager that installed zm, or only a look with `--check` (WC-CMD-5). */
export const addUpgradeCommand = (
  program: Command,
  streams: { data: (text: string) => void; diagnostic: (text: string) => void },
): void => {
  const upgrade = program.addCommand(
    annotate(
      upgradeCommand(ZM, "@wirecat/zoom-cli", (command) => {
        const format = command.parent?.opts().json ? "json" : "pretty"
        return {
          renderer: createRenderer({ format, color: false, streams }),
          format,
          streams,
          installer: () => installer(),
          latest: () => latest(),
          install: (argv) => runUpdate(argv),
        }
      }),
      { effects: FETCH },
    ),
  )
  // `addCommand` does not pass the program's exit and output handling down, as `command()` does.
  upgrade.commands.find((command) => command.name() === "upgrade")?.copyInheritedSettings(program)
}
