import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, itemOf, LOCAL_WRITE } from "@wirecat/cli-core/cli"
import { speechModel } from "@wirecat/cli-core/speech"
import type { Command } from "commander"
import { bytes, duration, runsLong } from "./execution.js"
import {
  compactLocalTranscriptionReceipt,
  type LocalTranscriptionCapabilities,
  type LocalTranscriptionOptions,
  validateLocalTranscriptionOptions,
} from "./local-transcription.js"

export const addLocalTranscriptionCommands = (
  program: Command,
  deps: {
    capabilities: () => Promise<LocalTranscriptionCapabilities>
    signal: () => AbortSignal | undefined
    output: (body: Body) => void
    receipt: (body: Body) => Promise<void>
  },
): void => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new CliError("configuration_error", "meeting command group is unavailable")
  annotate(
    runsLong(meetings.command("transcribe"))
      .description("preview transcribing a recording on this machine; --yes adds the transcript")
      .argument("<meeting>", "stored meeting id or meeting reference")
      .argument("<file>", "local PCM16 WAV file (16 or 48 kHz, mono/stereo)")
      .requiredOption("--model <model>", "installed speech model")
      .option("--models-dir <dir>", "shared installed speech-model directory")
      .option("--max-bytes <bytes>", "largest audio file to read, in bytes (default 1 GiB)", bytes)
      .option("--max-duration <duration>", "longest audio to transcribe (default 4h)", duration)
      .option("--max-segments <n>", "most recognized segments (default 10000)", bytes)
      .option("--max-text-bytes <bytes>", "most transcript text, in bytes (default 4 MiB)", bytes)
      .option("--yes", "recognize locally and append to the existing meeting")
      .option("--dry-run", "preview even when --yes is present")
      .action(
        async (
          reference: string,
          file: string,
          options: Omit<LocalTranscriptionOptions, "modelsDirectory" | "maxDurationMs" | "apply"> & {
            modelsDir?: string
            maxDuration?: number
            yes?: boolean
          },
        ) => {
          const request = validateLocalTranscriptionOptions({
            model: options.model,
            modelsDirectory: options.modelsDir,
            maxBytes: options.maxBytes,
            maxDurationMs: options.maxDuration,
            maxSegments: options.maxSegments,
            maxTextBytes: options.maxTextBytes,
            apply: options.yes,
            dryRun: options.dryRun,
            signal: deps.signal(),
          })
          speechModel(request.model)
          if (typeof file !== "string" || !file.trim() || file.includes("\0"))
            throw new CliError("validation_error", "local audio file is required")
          const capabilities = await deps.capabilities()
          const receipt = await capabilities.transcribe(reference, file, request)
          if (receipt.applied) await deps.receipt(itemOf(compactLocalTranscriptionReceipt(receipt)))
          else deps.output(itemOf(receipt))
        },
      ),
    {
      origin: "handwritten",
      effects: LOCAL_WRITE,
      examples: ["zm meetings transcribe meeting:3/12 ./AliceExample.wav --model parakeet-v3 --json"],
    },
  )
}
