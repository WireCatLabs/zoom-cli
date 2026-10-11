import { annotate } from "@wirecat/cli-base/commands"
import { speechModel } from "@wirecat/cli-messaging/speech"
import type { Command } from "commander"
import { ZoomError } from "./errors.js"
import { bytes, duration } from "./execution.js"
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
    output: (value: unknown) => void
    receipt: (value: unknown) => Promise<void>
  },
): void => {
  const meetings = program.commands.find((command) => command.name() === "meetings")
  if (!meetings) throw new ZoomError("configuration_error", "meeting command group is unavailable")
  annotate(
    meetings
      .command("transcribe")
      .description("preview local PCM WAV transcription; --yes recognizes and appends an independent transcript")
      .argument("<meeting>", "selected-account stored meeting id or meeting reference")
      .argument("<file>", "local PCM16 WAV file (16 or 48 kHz, mono/stereo)")
      .requiredOption("--model <model>", "explicit installed speech model")
      .option("--models-dir <directory>", "shared installed speech-model directory")
      .option("--max-bytes <bytes>", "bounded media input bytes (default 1 GiB)", bytes)
      .option("--max-duration <duration>", "bounded audio duration (default 4h)", duration)
      .option("--max-segments <count>", "recognized segment limit (default 10000)", bytes)
      .option("--max-text-bytes <bytes>", "aggregate transcript text limit (default 4 MiB)", bytes)
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
            throw new ZoomError("validation_error", "local audio file is required")
          const capabilities = await deps.capabilities()
          const receipt = await capabilities.transcribe(reference, file, request)
          if (receipt.applied) await deps.receipt(compactLocalTranscriptionReceipt(receipt))
          else deps.output(receipt)
        },
      ),
    {
      origin: "handwritten",
      mutates: true,
      local: true,
      examples: ["zm meetings transcribe meeting:3/12 ./AliceExample.wav --model parakeet-v3 --json"],
    },
  )
}
