import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, FETCH, itemOf, LOCAL_READ, listOf, NO_EFFECTS } from "@wirecat/cli-core/cli"
import {
  install,
  installedBytes,
  isInstalled,
  MODELS,
  megabytes,
  modelPath,
  modelsDirectory,
  type SpeechModel,
  speechModel,
  VAD,
  vadPath,
} from "@wirecat/cli-core/speech"
import type { Command } from "commander"

const itemOfModel = (model: SpeechModel, directory: string) => ({
  id: model.id,
  kind: "audio",
  title: model.title,
  languages: model.languages,
  sizeBytes: installedBytes(model),
  downloaded: isInstalled(model, directory),
  path: join(directory, model.id),
})

const sha256 = (path: string): Promise<string | null> =>
  new Promise((resolve) => {
    const hash = createHash("sha256")
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", () => resolve(null))
  })

/** A file of the right size can still be another version or broken, so its hash decides; a wrong one goes. */
const removeMismatched = async (model: SpeechModel, directory: string): Promise<string[]> => {
  const path = modelPath(directory, model)
  const files = [...model.files.map((file) => [file.sha256, path(file.name)]), [VAD.sha256, vadPath(directory)]]
  const removed: string[] = []
  for (const [expected, file] of files as [string, string][]) {
    const actual = await sha256(file)
    if (actual === null || actual === expected) continue
    await rm(file, { force: true })
    removed.push(file)
  }
  return removed
}

/**
 * `models audio list|download`: the speech models `meetings transcribe` runs, in the folder every WireCat CLI shares,
 * so a model downloaded by tg serves zm too. Downloading is the owner's command; transcription never downloads.
 */
export const addModelsCommands = (
  program: Command,
  deps: { env: () => NodeJS.ProcessEnv; output: (body: Body) => void; diagnostic: (text: string) => void },
): void => {
  const models = annotate(program.command("models"), { effects: NO_EFFECTS }).description(
    "models that run on this machine",
  )
  const audio = annotate(models.command("audio"), { effects: NO_EFFECTS }).description(
    "speech models for `meetings transcribe`",
  )
  annotate(audio.command("list"), { effects: LOCAL_READ, examples: ["zm models audio list --json"] })
    .description("the speech models this version knows, and which are downloaded")
    .action(() => {
      const directory = modelsDirectory(deps.env())
      const items = MODELS.map((model) => itemOfModel(model, directory))
      deps.output(listOf("models audio list", { items, limit: Math.max(1, items.length), has_more: false }))
    })
  annotate(audio.command("download"), { effects: FETCH, examples: ["zm models audio download parakeet-v3 --json"] })
    .argument("<model>", "a model id from `models audio list`")
    .description("download a speech model, or repair one, checking every file's sha256")
    .action(async (id: string) => {
      const model = speechModel(id)
      const directory = modelsDirectory(deps.env())
      for (const file of await removeMismatched(model, directory))
        deps.diagnostic(`${file}: not the file this version expects, downloading it again\n`)
      if (!isInstalled(model, directory)) {
        deps.diagnostic(`${model.id}: ${megabytes(installedBytes(model))} from Hugging Face\n`)
        await install(model, directory, { progress: (line) => deps.diagnostic(`${line}\n`) })
      }
      deps.output(itemOf(itemOfModel(model, directory)))
    })
}
