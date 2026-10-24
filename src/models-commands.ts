import { join } from "node:path"
import { annotate } from "@wirecat/cli-base/commands"
import { defineQuery } from "@wirecat/cli-base/query"
import {
  type Body,
  FETCH,
  itemOf,
  LOCAL_READ,
  listOf,
  NO_EFFECTS,
  queryTerms,
  termField,
  typedQuery,
  withQuery,
} from "@wirecat/cli-core/cli"
import {
  install,
  installedBytes,
  isInstalled,
  MODELS,
  modelsDirectory,
  type SpeechModel,
  speechModel,
} from "@wirecat/cli-core/speech"
import type { Command } from "commander"

/** The shared `models list` fields; zm ships speech models only, so `kind:text` lists none. */
const MODELS_QUERY = defineQuery({
  entity: "model",
  backend: "native",
  fields: [
    termField("kind", "enum", "kind:audio", { values: ["audio", "text"] }),
    termField("id", "kw", "id:parakeet-v3"),
    termField("downloaded", "bool", "downloaded:true"),
  ],
})

const itemOfModel = (model: SpeechModel, directory: string) => ({
  id: model.id,
  kind: "audio",
  title: model.title,
  languages: model.languages,
  size_bytes: installedBytes(model),
  downloaded: isInstalled(model, directory),
  // `meetings transcribe` requires --model, so no speech model is the default
  default: false,
  path: join(directory, model.id),
})

/**
 * `models list|download`: the speech models `meetings transcribe` runs, in the folder every WireCat CLI shares,
 * so a model downloaded by tg serves zm too. Downloading is the owner's command; transcription never downloads.
 */
export const addModelsCommands = (
  program: Command,
  deps: { env: () => NodeJS.ProcessEnv; output: (body: Body) => void; diagnostic: (text: string) => void },
): void => {
  const models = annotate(program.command("models"), { effects: NO_EFFECTS }).description(
    "speech models that run on this machine, for `meetings transcribe`",
  )
  withQuery(
    annotate(models.command("list"), {
      effects: LOCAL_READ,
      output: { entity: "model" },
      examples: ["zm models list --json", "zm models list kind:audio downloaded:false"],
    }),
    MODELS_QUERY,
  )
    .description("the speech models this version knows, and which are downloaded")
    .action((words: string[]) => {
      const terms = queryTerms(typedQuery(words), MODELS_QUERY, "models list")
      const kind = terms.get("kind")
      const id = terms.get("id")
      const downloaded = terms.get("downloaded")
      const directory = modelsDirectory(deps.env())
      const items = MODELS.filter(() => kind === undefined || kind === "audio")
        .filter((model) => id === undefined || model.id === id)
        .map((model) => itemOfModel(model, directory))
        .filter((item) => downloaded === undefined || item.downloaded === (downloaded === "true"))
      deps.output(listOf("models list", { items, limit: Math.max(1, items.length), has_more: false }))
    })
  annotate(models.command("download"), {
    effects: FETCH,
    output: { entity: "model" },
    examples: ["zm models download parakeet-v3 --json"],
  })
    .argument("<model>", "a model id from `models list`")
    .description("download a speech model, or repair one, checking every file's sha256")
    .action(async (id: string) => {
      const model = speechModel(id)
      const directory = modelsDirectory(deps.env())
      await install(model, directory, { verifyExisting: true, progress: (line) => deps.diagnostic(`${line}\n`) })
      deps.output(itemOf(itemOfModel(model, directory)))
    })
}
