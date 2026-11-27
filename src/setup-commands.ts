import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import {
  type Body,
  environmentOf,
  grantsAuthority,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  NO_EFFECTS,
  settingRows,
} from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { zoomAccountRemoveCommand } from "./account-removal.js"
import { addStandardCommands } from "./commands.js"
import { inspectConfig, migrateConfig, setConfig, unsetConfig, ZOOM_SETTINGS } from "./config.js"
import { addModelsCommands } from "./models-commands.js"
import { permissionKeys } from "./permissions.js"
import type { ProgramDeps } from "./program.js"
import { addUpgradeCommand } from "./upgrade.js"
import { zoomAppChecklist, zoomAppSetup } from "./zoom-app.js"

const refuseAgentPermissions = (command: Command, key: string) => {
  if (environmentOf(command).agent && (key === "permissions" || key.startsWith("permissions.")))
    throw new CliError("permission_error", "change profile permissions in a terminal")
}

export const addConfigCommands = (
  program: Command,
  {
    configPath,
    output,
    warn,
    named,
  }: {
    configPath: string
    output: (body: Body) => void
    warn: (text: string) => void
    /** The profile named for this command, if any; never asks for one. */
    named: () => string | undefined
  },
): void => {
  const cfg = annotate(program.command("config"), { effects: NO_EFFECTS }).description("local Zoom configuration")
  annotate(cfg.command("show"), { effects: LOCAL_READ })
    .description("show local configuration")
    .action(() => {
      const { config, issues, raw } = inspectConfig(configPath, permissionKeys(program))
      output(itemOf({ ...config, settings: settingRows(raw ?? {}, ZOOM_SETTINGS) }))
      for (const issue of issues)
        warn(`${issue.what}, so it is left out${issue.fix ? ` — \`${issue.fix}\` removes it` : ""}`)
    })
  grantsAuthority(annotate(cfg.command("set"), { effects: LOCAL_WRITE }))
    .description("set a configuration value")
    .argument("<key>", "setting name, such as zoom.client_id")
    .argument("<value>", "new value")
    .action(function (this: Command, key: string, value: string) {
      refuseAgentPermissions(this, key)
      output(itemOf(setConfig(configPath, key, value, named, permissionKeys(program))))
    })
  grantsAuthority(annotate(cfg.command("unset"), { effects: LOCAL_WRITE, examples: ["zm config unset files.folder"] }))
    .description("remove a setting, or a part of the file doctor reports a problem in")
    .argument("<key>", "setting name, such as files.folder, or the key a doctor fix names")
    .action(function (this: Command, key: string) {
      refuseAgentPermissions(this, key)
      output(itemOf(unsetConfig(configPath, key, named(), permissionKeys(program))))
    })
  grantsAuthority(annotate(cfg.command("migrate"), { effects: LOCAL_WRITE, examples: ["zm config migrate"] }))
    .description("write each setting the file lacks at its default, keeping yours")
    .action(() => {
      const added = migrateConfig(configPath)
      output(itemOf({ config_file: configPath, added }))
      warn(added.length > 0 ? `added ${added.join(", ")} to ${configPath}` : `${configPath} already has every setting`)
    })
}

/** What to enter when making the Zoom app: a checklist for a person, the same facts as JSON for a window. */
export const addAppCommand = (
  program: Command,
  { output, buffer, pretty }: { output: (body: Body) => void; buffer: (text: string) => void; pretty: () => boolean },
): void => {
  annotate(program.command("app"), { effects: NO_EFFECTS, examples: ["zm app", "zm app --json"] })
    .description("what to enter when you make the Zoom app zm signs in with")
    .action(() => {
      if (pretty()) buffer(`${zoomAppChecklist()}\n`)
      else output(itemOf(zoomAppSetup()))
    })
}

/** The shared discovery and store commands, `upgrade`, `models` and `account remove`. */
export const addSharedCommands = (
  program: Command,
  { deps, buffer, output }: { deps: ProgramDeps; buffer: (text: string) => void; output: (body: Body) => void },
): void => {
  addStandardCommands(program)
  addUpgradeCommand(program, { data: buffer, diagnostic: deps.diagnostic })
  addModelsCommands(program, { env: () => deps.env ?? process.env, output, diagnostic: deps.diagnostic })
  annotate(program.command("account"), { effects: NO_EFFECTS })
    .description("the profile's login and data on this computer")
    .addCommand(zoomAccountRemoveCommand(deps))
}
