import { createHash } from "node:crypto"
import { CliError } from "@wirecat/cli-core"
import type { MeetingTranscriptReceiptStore, MeetingTranscriptStore, TranscriptAppend } from "@wirecat/cli-meetings"
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
  created?: boolean
  insertedTranscripts?: number
  replayedTranscripts?: number
  supersededTranscripts?: number
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
    let startedAt: number | null = null
    if (meeting.startedAt !== null) {
      startedAt = Date.parse(meeting.startedAt)
      if (
        !Number.isSafeInteger(startedAt) ||
        Math.abs(startedAt) > 8640000000000000 ||
        new Date(startedAt).toISOString() !== meeting.startedAt
      )
        throw new ZoomError("validation_error", "archive occurrence start must be a real ISO timestamp")
    }
    const group = prepared.get(meeting.uuid) ?? {
      uuid: meeting.uuid,
      assetIds: [],
      transcripts: [],
      ...(startedAt !== null ? { create: { title: meeting.title, startedAt, timezone: null } } : {}),
    }
    group.assetIds.push(asset.id)
    group.transcripts.push({
      source: `zoom-archive:vtt:${createHash("sha256").update(asset.id).digest("hex")}`,
      contentHash: asset.sha256,
      format: "vtt",
      language: null,
      externalCreatedAt: null,
      deletedAt: null,
      metadata: {
        provider: "zoom",
        occurrenceUuid: meeting.uuid,
        recordingFileId: asset.id,
        archivePath: asset.path,
        sha256: asset.sha256,
        archiveManifestVersion: 1,
        recordingType: asset.type,
        recordingFormat: asset.format,
        recordingStartedAt: asset.startedAt,
        recordingEndedAt: asset.endedAt,
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
  store: Partial<MeetingTranscriptStore & MeetingTranscriptReceiptStore>,
  options: { accountId: number; now?: number; signal?: AbortSignal },
): AsyncGenerator<ArchiveImportReceipt, void, void> {
  const prepared = plans.get(plan)
  const { accountId, signal } = options
  const now = options.now ?? Date.now()
  const appendExact = store?.appendTranscriptsWithReceipt
  const appendLegacy = store?.appendTranscripts
  const useExact = typeof appendExact === "function"
  if (!prepared || !Number.isSafeInteger(accountId) || accountId < 1 || !Number.isSafeInteger(now))
    throw new ZoomError("validation_error", "expected a verified archive plan, selected account and integer timestamp")
  if (typeof appendLegacy !== "function" && !useExact)
    throw new ZoomError("configuration_error", "the installed meeting store does not support transcript append")
  for (const group of prepared) {
    checkCancelled(signal)
    let receipt: ArchiveImportReceipt
    try {
      const input: TranscriptAppend = {
        accountId: accountId,
        externalId: group.uuid,
        create: group.create,
        transcripts: structuredClone(group.transcripts),
        now,
      }
      const exact = useExact ? await appendExact.call(store, input) : undefined
      const details = useExact ? exact?.meeting : await appendLegacy?.call(store, input)
      if (
        !details?.meeting ||
        details.meeting.accountId !== accountId ||
        details.meeting.externalId !== group.uuid ||
        !Number.isSafeInteger(details.meeting.id) ||
        details.meeting.id < 1 ||
        details.meeting.deletedAt !== null
      )
        throw new ZoomError(
          "outcome_unknown",
          "archive append returned inconsistent ownership; verify stored state before retrying",
        )
      if (
        exact &&
        (typeof exact.created !== "boolean" ||
          exact.insertedTranscripts + exact.replayedTranscripts !== group.transcripts.length ||
          [exact.insertedTranscripts, exact.replayedTranscripts, exact.supersededTranscripts].some(
            (count) => !Number.isSafeInteger(count) || count < 0,
          ))
      )
        throw new ZoomError(
          "outcome_unknown",
          "archive append returned invalid counts; verify stored state before retrying",
        )
      receipt = {
        uuid: group.uuid,
        assetIds: [...group.assetIds],
        status: "acknowledged",
        meetingId: details.meeting.id,
        ...(exact
          ? {
              created: exact.created,
              insertedTranscripts: exact.insertedTranscripts,
              replayedTranscripts: exact.replayedTranscripts,
              supersededTranscripts: exact.supersededTranscripts,
            }
          : {}),
      }
    } catch (error) {
      if (error instanceof CliError && (error.code === "timeout" || error.code === "cancelled")) {
        checkCancelled(signal)
        throw error
      }
      if (error instanceof Error && "code" in error && error.code === "outcome_unknown")
        throw new ZoomError("outcome_unknown", "archive append outcome is unknown; verify stored state before retrying")
      if (error instanceof Error && "code" in error && error.code === "not_found")
        receipt = {
          uuid: group.uuid,
          assetIds: [...group.assetIds],
          status: "unavailable",
          reason: "missing_or_deleted",
        }
      else {
        checkCancelled(signal)
        throw new ZoomError("provider_error", "archive transcript append failed; earlier occurrences may be committed")
      }
    }
    yield receipt
  }
}
