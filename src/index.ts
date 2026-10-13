export { encodeUuid, ZoomApiSource } from "./api.js"
export {
  type ArchiveImportOptions,
  type ArchiveImportPlan,
  type ArchiveImportReceipt,
  applyArchiveImport,
  preflightArchiveImport,
} from "./archive-import.js"
export {
  type ArchiveTranscript,
  type ArchiveTranscriptMatch,
  type ArchiveTranscriptOptions,
  type ArchiveTranscriptSearchOptions,
  type ArchiveTranscriptSearchReport,
  readArchiveTranscripts,
  searchArchiveTranscripts,
} from "./archive-transcripts.js"
export { profileAccountKey, readConfig, setConfig, type ZoomConfig } from "./config.js"
export { ZoomError } from "./errors.js"
export {
  type DownloadedFile,
  FilesSource,
  fileMeeting,
  importFile,
  readDownloadedFiles,
  validateDownloadedFiles,
} from "./files.js"
export {
  createLocalTranscriptionCapabilities,
  createWavTranscriptionSource,
  type LocalSpeechPort,
  type LocalTranscriptionCapabilities,
  type LocalTranscriptionOptions,
  type LocalTranscriptionTarget,
} from "./local-transcription.js"
export { type LoginOptions, login, REDIRECT } from "./login.js"
export { createMeetingMcpServer, type MeetingMcpOptions, serveMeetingMcp } from "./mcp-server.js"
export {
  createMeetingContextCapabilities,
  type EvidenceOptions,
  type MeetingContextCapabilities,
  type MeetingTaskKind,
  type PersonContextOptions,
} from "./meeting-context.js"
export type { MeetingIntegrationCapabilities, MeetingLinkChange } from "./meeting-integration.js"
export type { MeetingHitSearch, MeetingHitSearchOptions } from "./meeting-search-commands.js"
export { createMeetingSemanticCapabilities } from "./meeting-semantic.js"
export type {
  MeetingEmbeddingOptions,
  MeetingModelOptions,
  MeetingSemanticCapabilities,
  MeetingSemanticOptions,
} from "./meeting-semantic-commands.js"
export { createProgram, type ProgramDeps, run, type StoreConnection, type StoreConnectRequest } from "./program.js"
export {
  createRecordingScheduleService,
  parseRecordingScheduleJob,
  type RecordingScheduleBackend,
  type RecordingScheduleCapture,
  type RecordingScheduleCreateInput,
  type RecordingScheduleJob,
  type RecordingScheduleReceipt,
  type RecordingScheduleService,
  type RecordingScheduleStore,
  type RecordingScheduleUnits,
  snapshotRecordingScheduleCapture,
  validateRecordingScheduleId,
} from "./recording-schedule.js"
export { fileRecordingScheduleStore } from "./recording-schedule-store.js"
export { createSystemdRecordingArchiveScheduler, type RecordingScheduleExecutor } from "./recording-schedule-systemd.js"
export { type ArchiveSyncOptions, type ArchiveSyncReceipt, syncRecordingArchive } from "./recording-sync.js"
export {
  type ArchivedFile,
  type ArchiveLockInfo,
  type ArchiveManifest,
  type ArchiveReport,
  type ArchiveVerification,
  type DownloadOptions,
  getZoomProfile,
  inspectArchive,
  inspectArchiveLocks,
  type RecordingAsset,
  type RecordingMeeting,
  type RecordingRange,
  recoverArchiveLocks,
  verifyArchive,
  type ZoomProfile,
  ZoomRecordings,
} from "./recordings.js"
export {
  createZoomMeetingManagement,
  type MeetingChange,
  type MeetingMutation,
  type MutationOptions,
  type RemoteMeeting,
  ZoomRemoteMeetings,
} from "./remote-meetings.js"
export { createStoreConnector, type StoreConnectionOptions } from "./store-connection.js"
export { TokenManager, type TokenOptions, type Tokens } from "./tokens.js"

export { runUnifiedSearch, type UnifiedSearch, type UnifiedSearchRequest } from "./unified-search.js"
