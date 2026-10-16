import { type RecordingAssetLocator, type RecordingPartial, strongRecordingValidator } from "@wirecat/cli-core/meetings"
import { NativeRecordingPublication } from "@wirecat/cli-core/persistence/native"
import type { ArchivedFile, ArchiveManifest } from "./recording-archive.js"

export interface RecordingPromotion {
  version: 1
  locator: RecordingAssetLocator
  meeting: ArchiveManifest["meeting"]
  file: ArchivedFile
  validator: string
}
const scope = (locator: RecordingAssetLocator) => [
  locator.provider,
  locator.account,
  locator.occurrenceId,
  locator.assetId,
]
const keys = (value: object, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key))
export const recordingPublication = (
  root: string,
  locator: RecordingAssetLocator,
  meeting: ArchiveManifest["meeting"],
  expected: Omit<ArchivedFile, "size" | "sha256">,
  maxBytes: number,
  signal?: AbortSignal,
) =>
  new NativeRecordingPublication<RecordingPromotion>(root, locator, {
    prefix: ".zoom-promotion-",
    filename: expected.path,
    maxBytes,
    metadataLimit: 32768,
    signal,
    codec: {
      encode: (value) => JSON.stringify(value),
      decode: (value) => {
        const record = value as RecordingPromotion
        if (
          record.version !== 1 ||
          !keys(record, ["version", "locator", "meeting", "file", "validator"]) ||
          !keys(record.locator, ["provider", "account", "occurrenceId", "assetId"]) ||
          JSON.stringify(scope(record.locator)) !== JSON.stringify(scope(locator)) ||
          !keys(record.meeting, ["id", "uuid", "title", "startedAt"]) ||
          record.meeting.id !== meeting.id ||
          record.meeting.uuid !== meeting.uuid ||
          record.meeting.title !== meeting.title ||
          record.meeting.startedAt !== meeting.startedAt ||
          !keys(record.file, [
            "id",
            "path",
            "remoteSize",
            "type",
            "format",
            "startedAt",
            "endedAt",
            "size",
            "sha256",
          ]) ||
          Object.entries(expected).some(([key, value]) => record.file[key as keyof ArchivedFile] !== value) ||
          !Number.isSafeInteger(record.file.size) ||
          record.file.size < 0 ||
          !/^[a-f0-9]{64}$/.test(record.file.sha256) ||
          !strongRecordingValidator(record.validator)
        )
          throw new Error("record shape")

        return record
      },
    },
    evidence: (value) => ({ size: value.file.size, sha256: value.file.sha256, validator: value.validator }),
  })

export const recordingPromotion = (
  locator: RecordingAssetLocator,
  meeting: ArchiveManifest["meeting"],
  file: ArchivedFile,
  completed: RecordingPartial,
): RecordingPromotion => ({
  version: 1,
  locator: {
    provider: locator.provider,
    account: locator.account,
    occurrenceId: locator.occurrenceId,
    assetId: locator.assetId,
  },
  meeting: { ...meeting },
  file: { ...file },
  validator: completed.validator,
})
