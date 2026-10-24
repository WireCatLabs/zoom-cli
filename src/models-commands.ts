import { type Body, modelCatalogueCommand } from "@wirecat/cli-core/cli"
import type { Command } from "commander"

export const addModelsCommands = (
  program: Command,
  deps: { env: () => NodeJS.ProcessEnv; output: (body: Body) => void; diagnostic: (text: string) => void },
): void => {
  program.addCommand(
    modelCatalogueCommand(
      { command: "zm", appName: "zoom-cli", envPrefix: "ZM", description: "Zoom meetings", version: "" },
      {
        kinds: ["audio"],
        env: deps.env,
        output: deps.output,
        diagnostic: deps.diagnostic,
        offline: () => program.opts().offline === true,
      },
    ),
  )
}
