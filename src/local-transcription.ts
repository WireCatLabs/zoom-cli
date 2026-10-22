import { isAbsolute } from "node:path"
import { CliError } from "@wirecat/cli-base"
import type {
  MeetingMediaDescriptor,
  MeetingTranscriptionOptions,
  MeetingTranscriptionReceipt,
  MeetingTranscriptionSource,
  MeetingTranscriptReceiptStore,
} from "@wirecat/cli-core/meetings"
import type {
  LocalSpeechRecognitionModel,
  LocalSpeechRecognizer,
  LocalSpeechRecognizerOptions,
} from "@wirecat/cli-core/speech"
import { openWavAudio, preflightWavAudio, type WavAudioPlan } from "@wirecat/cli-core/speech/wav"
import { checkCancelled } from "./errors.js"
import { wavFor } from "./media-decode.js"

export interface LocalSpeechPort {
  describe(model: string): Readonly<LocalSpeechRecognitionModel>
  open(model: string, options: LocalSpeechRecognizerOptions): Promise<LocalSpeechRecognizer>
}
export interface LocalTranscriptionOptions extends MeetingTranscriptionOptions {
  model: string
  modelsDirectory?: string
}
export interface LocalTranscriptionTarget {
  accountId: number
  meetingId: number
  externalId: string
}
export interface LocalTranscriptionCapabilities {
  transcribe(reference: string, file: string, options: LocalTranscriptionOptions): Promise<MeetingTranscriptionReceipt>
}
export const validateLocalTranscriptionOptions = (input: LocalTranscriptionOptions): LocalTranscriptionOptions => {
  const options = { ...input }
  if (
    typeof options.model !== "string" ||
    !options.model.trim() ||
    options.model.length > 200 ||
    /[\0\r\n]/.test(options.model)
  )
    throw new CliError("validation_error", "local transcription requires an explicit speech model")
  if (
    options.modelsDirectory !== undefined &&
    (typeof options.modelsDirectory !== "string" ||
      !isAbsolute(options.modelsDirectory) ||
      options.modelsDirectory.length > 4096 ||
      /[\0\r\n]/.test(options.modelsDirectory))
  )
    throw new CliError("validation_error", "speech model directory must be an absolute bounded path")
  for (const [value, max, label] of [
    [options.maxBytes, 4 * 1024 ** 3, "media bytes"],
    [options.maxDurationMs, 24 * 3600_000, "media duration"],
    [options.maxSegments, 100000, "segment count"],
    [options.maxTextBytes, 64 * 1024 ** 2, "transcript text bytes"],
  ] as const)
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > max))
      throw new CliError("validation_error", `invalid ${label} budget`)
  for (const value of [options.apply, options.dryRun])
    if (value !== undefined && typeof value !== "boolean")
      throw new CliError("validation_error", "transcription apply and dry-run options must be booleans")
  return options
}
export const compactLocalTranscriptionReceipt = (receipt: MeetingTranscriptionReceipt) => {
  const append = receipt.append
  if (!receipt.applied || !append || !Number.isSafeInteger(append.meeting.meeting.id) || append.meeting.meeting.id < 1)
    throw new CliError("outcome_unknown", "transcription did not return a usable committed acknowledgement")
  return {
    applied: true as const,
    accountId: receipt.accountId,
    externalId: receipt.externalId,
    meetingId: append.meeting.meeting.id,
    created: append.created,
    insertedTranscripts: append.insertedTranscripts,
    replayedTranscripts: append.replayedTranscripts,
    supersededTranscripts: append.supersededTranscripts,
    segments: receipt.segments,
    mediaSha256: receipt.media.contentHash,
    engine: receipt.media.recognition.engine,
    model: receipt.media.recognition.model,
    modelVersion: receipt.media.recognition.version ?? null,
    timing: receipt.media.recognition.timing ?? "recognition-segments",
  }
}
/**
 * The speech engine is WebAssembly; a model file it cannot read surfaces as a bare number thrown, not an Error. It is
 * almost always a file of the wrong version or a broken download.
 */
const engineFailure = async <T>(model: string, work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    if (error instanceof Error) throw error
    throw new CliError(
      "configuration_error",
      `the speech engine could not run ${model}; \`zm models audio download ${model}\` checks its files and repairs them`,
    )
  }
}
const loadSpeech = async (): Promise<LocalSpeechPort> => {
  const speech = await import("@wirecat/cli-core/speech")
  return { describe: speech.localSpeechRecognitionModel, open: speech.openLocalSpeechRecognizer }
}
export const createWavTranscriptionSource = (
  file: string,
  options: {
    model: string
    modelsDirectory?: string
    env?: NodeJS.ProcessEnv
    speech?: () => Promise<LocalSpeechPort>
  },
): MeetingTranscriptionSource => {
  const selected = { ...options, ...(options.env ? { env: { ...options.env } } : {}) }
  let plan: WavAudioPlan | undefined
  let recognition: Readonly<LocalSpeechRecognitionModel> | undefined
  let speech: LocalSpeechPort | undefined
  return {
    async describe(context) {
      checkCancelled(context.signal)
      speech = await (selected.speech ?? loadSpeech)()
      recognition = Object.freeze({ ...speech.describe(selected.model) })
      plan = await preflightWavAudio(file, context)
      return Object.freeze({
        ...plan.media,
        recognition: Object.freeze({
          engine: recognition.engine,
          model: recognition.model,
          version: recognition.version,
          timing: "fixed-windows" as const,
        }),
      })
    },
    async *segments(media, context) {
      if (
        !plan ||
        !recognition ||
        !speech ||
        media.contentHash !== plan.media.contentHash ||
        media.id !== plan.media.id ||
        media.size !== plan.media.size ||
        media.durationMs !== plan.media.durationMs ||
        media.recognition.engine !== recognition.engine ||
        media.recognition.model !== recognition.model ||
        media.recognition.version !== recognition.version
      )
        throw new CliError(
          "validation_error",
          "transcription media descriptor does not match its prepared audio and model",
        )
      const audio = await openWavAudio(plan, context)
      let model: LocalSpeechRecognizer | undefined
      try {
        checkCancelled(context.signal)
        const port = speech
        const chosen = recognition.model
        model = await engineFailure(chosen, () =>
          port.open(chosen, {
            directory: selected.modelsDirectory,
            env: selected.env,
            signal: context.signal,
          }),
        )
        if (
          model.engine !== recognition.engine ||
          model.model !== recognition.model ||
          model.version !== recognition.version
        )
          throw new CliError("validation_error", "installed speech recognizer changed after the media preview")
        for await (const window of audio.windows()) {
          checkCancelled(context.signal)
          const recognizer = model
          const text = await engineFailure(recognition.model, () =>
            recognizer.recognize(window.samples, { signal: context.signal }),
          )
          checkCancelled(context.signal)
          yield { startMs: window.startMs, endMs: window.endMs, text }
        }
      } finally {
        try {
          await model?.close()
        } finally {
          await audio.close()
        }
      }
    },
  }
}
export const createLocalTranscriptionCapabilities = (
  store: {
    accountId: number
    resolveMeeting(reference: string, signal?: AbortSignal): Promise<LocalTranscriptionTarget | null>
    appendTranscriptsWithReceipt: MeetingTranscriptReceiptStore["appendTranscriptsWithReceipt"]
  },
  input: { env?: NodeJS.ProcessEnv; now?: () => number; speech?: () => Promise<LocalSpeechPort> } = {},
): LocalTranscriptionCapabilities => {
  const accountId = store.accountId
  if (!Number.isSafeInteger(accountId) || accountId < 1)
    throw new CliError("validation_error", "local transcription requires a selected existing account")
  const options = { ...input, ...(input.env ? { env: { ...input.env } } : {}) }
  const resolveMeeting = store.resolveMeeting.bind(store)
  const appendTranscriptsWithReceipt = store.appendTranscriptsWithReceipt.bind(store)
  return {
    async transcribe(reference, file, raw) {
      const request = validateLocalTranscriptionOptions(raw)
      checkCancelled(request.signal)
      const resolved = await resolveMeeting(reference, request.signal)
      const found = resolved && {
        accountId: resolved.accountId,
        meetingId: resolved.meetingId,
        externalId: resolved.externalId,
      }
      if (
        !found ||
        found.accountId !== accountId ||
        !Number.isSafeInteger(found.meetingId) ||
        found.meetingId < 1 ||
        typeof found.externalId !== "string" ||
        !found.externalId.trim()
      )
        throw new CliError("not_found", "meeting was not found in the selected account")
      const target = Object.freeze({ accountId, externalId: found.externalId, now: options.now?.() ?? Date.now() })
      const audio = await wavFor(file, { signal: request.signal })
      try {
        const source = createWavTranscriptionSource(audio.path, {
          model: request.model,
          modelsDirectory: request.modelsDirectory,
          env: options.env,
          speech: options.speech,
        })
        const { transcribeMeeting } = await import("@wirecat/cli-core/meetings")
        return await transcribeMeeting(
          source,
          {
            appendTranscriptsWithReceipt(value) {
              if (value.accountId !== accountId || value.externalId !== target.externalId)
                throw new CliError("validation_error", "transcription append must retain its selected target")
              return appendTranscriptsWithReceipt(value)
            },
          },
          target,
          request,
        )
      } finally {
        await audio.release()
      }
    },
  }
}
export type { MeetingMediaDescriptor }
