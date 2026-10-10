import { createHash } from "node:crypto"
import type { MeetingTranscriptStore, TranscriptAppend } from "@wirecat/cli-meetings"
import { type ArchiveTranscriptOptions, readArchiveTranscripts } from "./archive-transcripts.js"
import { checkCancelled, ZoomError } from "./errors.js"

export interface ArchiveImportOptions extends ArchiveTranscriptOptions {
  maxTotalBytes?: number
}
export interface ArchiveImportPlan {
  readonly verifiedAssets: number
  readonly occurrences: number
  readonly totalBytes: number
}
export interface ArchiveImportReceipt {
  uuid: string
  assetIds: string[]
  status: "acknowledged" | "unavailable"
  meetingId?: number
  /** The append port does not distinguish a missing occurrence from a deleted one. */
  reason?: "missing_or_deleted"
}
interface Prepared {
  uuid: string
  assetIds: string[]
  create?: TranscriptAppend["create"]
  transcripts: TranscriptAppend["transcripts"]
}
const plans = new WeakMap<ArchiveImportPlan, Prepared[]>()

/** Complete verification and bounded preparation before the caller opens or registers an account. */
export const preflightArchiveImport = async (
  destination: string,
  options: ArchiveImportOptions = {},
): Promise<ArchiveImportPlan> => {
  const maximum = options.maxTotalBytes === undefined ? 64 * 1024 ** 2 : options.maxTotalBytes
  if (!Number.isSafeInteger(maximum) || maximum <= 0)
    throw new ZoomError("validation_error", "aggregate transcript byte limit must be a positive integer")
  const prepared = new Map<string, Prepared>()
  let verifiedAssets = 0
  let totalBytes = 0
  for await (const { meeting, asset, cues } of readArchiveTranscripts(destination, options)) {
    checkCancelled(options.signal)
    if (
      cues.some(
        (cue) =>
          !Number.isSafeInteger(cue.startMs) ||
          !Number.isSafeInteger(cue.endMs) ||
          cue.startMs < 0 ||
          cue.endMs < cue.startMs,
      )
    )
      throw new ZoomError("validation_error", "archive transcript cue times must be safe nonnegative ordered integers")
    totalBytes += asset.size
    if (totalBytes > maximum) throw new ZoomError("validation_error", "archive import exceeds the aggregate byte limit")
    const group = prepared.get(meeting.uuid) ?? {
      uuid: meeting.uuid,
      assetIds: [],
      transcripts: [],
      ...(meeting.startedAt
        ? { create: { title: meeting.title, startedAt: Date.parse(meeting.startedAt), timezone: "UTC" } }
        : {}),
    }
    group.assetIds.push(asset.id)
    group.transcripts.push({
      source: `zoom-archive:vtt:${createHash("sha256").update(asset.id).digest("hex")}`,
      contentHash: asset.sha256,
      format: "vtt",
      language: null,
      externalCreatedAt: asset.startedAt === null ? null : Date.parse(asset.startedAt),
      deletedAt: null,
      metadata: {
        provider: "zoom",
        occurrenceUuid: meeting.uuid,
        recordingFileId: asset.id,
        archivePath: asset.path,
        sha256: asset.sha256,
      },
      rows: cues.map((cue, position) => ({
        position,
        startMs: cue.startMs,
        endMs: cue.endMs,
        speakerName: cue.speaker,
        text: cue.text,
        normalizedText: null,
        metadata: null,
      })),
    })
    prepared.set(meeting.uuid, group)
    verifiedAssets++
  }
  const plan = Object.freeze({ verifiedAssets, occurrences: prepared.size, totalBytes })
  plans.set(plan, [...prepared.values()])
  return plan
}

/** Atomic per occurrence, preserving an acknowledged receipt even when cancellation arrives during append. */
export async function* applyArchiveImport(
  plan: ArchiveImportPlan,
  store: MeetingTranscriptStore,
  options: { accountId: number; now?: number; signal?: AbortSignal },
): AsyncGenerator<ArchiveImportReceipt, void, void> {
  const prepared = plans.get(plan)
  const now = options.now ?? Date.now()
  if (!prepared || !Number.isSafeInteger(options.accountId) || options.accountId < 1 || !Number.isSafeInteger(now))
    throw new ZoomError("validation_error", "expected a verified archive plan, selected account and integer timestamp")
  if (typeof store?.appendTranscripts !== "function")
    throw new ZoomError("configuration_error", "the installed meeting store does not support transcript append")
  for (const group of prepared) {
    checkCancelled(options.signal)
    let receipt: ArchiveImportReceipt
    try {
      const details = await store.appendTranscripts({
        accountId: options.accountId,
        externalId: group.uuid,
        create: group.create,
        transcripts: structuredClone(group.transcripts),
        now,
      })
      receipt = {
        uuid: group.uuid,
        assetIds: [...group.assetIds],
        status: "acknowledged",
        meetingId: details.meeting.id,
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "not_found")
        receipt = {
          uuid: group.uuid,
          assetIds: [...group.assetIds],
          status: "unavailable",
          reason: "missing_or_deleted",
        }
      else {
        checkCancelled(options.signal)
        throw new ZoomError("provider_error", "archive transcript append failed; earlier occurrences may be committed")
      }
    }
    yield receipt
  }
}
