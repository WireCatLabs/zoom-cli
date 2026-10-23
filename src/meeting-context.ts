import { CliError } from "@wirecat/cli-base"
import type { MeetingPassageReader } from "@wirecat/cli-core/meetings"
import type {
  MeetingEvidencePacket,
  MeetingReadStore,
  PersonMeetingContext,
  PersonMeetingReadStore,
  TaskKind,
} from "@wirecat/cli-core/services"
import type { MeetingContextReadCapabilities } from "@wirecat/cli-core/store"
import { checkCancelled } from "./errors.js"

export type MeetingTaskKind = TaskKind
export interface EvidenceOptions {
  cues?: number
  bytes?: number
  signal?: AbortSignal
  after?: string
  afterTranscriptId?: number
  maxReadBytes?: number
  maxTranscriptPages?: number
}
export interface PersonContextOptions extends Pick<EvidenceOptions, "cues" | "bytes" | "signal"> {
  meetings?: number
  scanLimit?: number
  since?: number
}
/** Each callback is bound to the connection's selected account; producer DTOs pass through unchanged. */
export interface MeetingContextCapabilities {
  passage: MeetingPassageReader
  evidence: (reference: string, options?: EvidenceOptions) => Promise<MeetingEvidencePacket>
  personContext: (person: string, options?: PersonContextOptions) => Promise<PersonMeetingContext>
  taskProposal: (reference: string, kind: MeetingTaskKind, signal?: AbortSignal) => Promise<unknown>
}
type ProducerContextApi = Pick<
  typeof import("@wirecat/cli-core"),
  "parseMeetingReference" | "canonicalMeetingReference"
> &
  Pick<
    typeof import("@wirecat/cli-core/services"),
    "readMeetingEvidence" | "personMeetingContext" | "proposeMeetingTask" | "readMeetingPassage"
  >

const integer = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max
export const validateEvidenceOptions = (options: EvidenceOptions = {}) => {
  if (
    !integer(options.cues ?? 100, 1, 1000) ||
    !integer(options.bytes ?? 65536, 2, 4194304) ||
    !integer(options.maxReadBytes ?? 4194304, 1, 67108864) ||
    !integer(options.maxTranscriptPages ?? 100, 1, 1000) ||
    (options.afterTranscriptId !== undefined && !integer(options.afterTranscriptId, 1, Number.MAX_SAFE_INTEGER)) ||
    (options.after !== undefined && options.afterTranscriptId !== undefined) ||
    (options.after !== undefined && (typeof options.after !== "string" || !options.after.trim()))
  )
    throw new CliError("validation_error", "meeting evidence requires 1–1000 cues and 2–4194304 bytes")
}
export const validatePersonContext = (person: string, options: PersonContextOptions = {}) => {
  validateEvidenceOptions(options)
  if (
    typeof person !== "string" ||
    !/^person:[1-9]\d*$/.test(person) ||
    !integer(Number(person.slice(7)), 1, Number.MAX_SAFE_INTEGER) ||
    !integer(options.meetings ?? 10, 1, 100) ||
    !integer(options.scanLimit ?? 1000, 1, 1000) ||
    (options.since !== undefined && !Number.isSafeInteger(options.since))
  )
    throw new CliError(
      "validation_error",
      "person meeting context requires person:<positive ID> and valid bounded limits",
    )
}
export const validateTaskKind = (kind: string): MeetingTaskKind => {
  if (!["question", "request", "mention", "promise"].includes(kind))
    throw new CliError("validation_error", "task kind must be question, request, mention or promise")
  return kind as MeetingTaskKind
}
export const validateTaskProposal = (value: unknown): void => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("applied" in value) ||
    value.applied !== false ||
    !("persistence" in value) ||
    value.persistence !== "proposal-only"
  )
    throw new CliError("invalid_response", "task proposal must be unapplied and proposal-only")
}
const loadProducer = async (): Promise<ProducerContextApi> => {
  const [domain, services] = await Promise.all([import("@wirecat/cli-core"), import("@wirecat/cli-core/services")])
  return { ...services, ...domain }
}
export const createMeetingContextCapabilities = (
  store: Omit<PersonMeetingReadStore, "meetings">,
  meetings: MeetingReadStore & MeetingContextReadCapabilities,
  accountId: number,
  load: () => Promise<ProducerContextApi> = loadProducer,
): MeetingContextCapabilities => {
  if (!integer(accountId, 1, Number.MAX_SAFE_INTEGER))
    throw new CliError("validation_error", "meeting context requires a selected positive account ID")
  const ownedReference = (api: ProducerContextApi, reference: string) => {
    if (api.parseMeetingReference(reference).accountId !== accountId)
      throw new CliError("not_found", "meeting reference is unavailable for the selected account")
    return api.canonicalMeetingReference(reference)
  }
  return {
    passage: async (reference, options = {}) => {
      checkCancelled(options.signal)
      const api = await load()
      checkCancelled(options.signal)
      const owned = ownedReference(api, reference)
      const result = await api.readMeetingPassage(meetings, accountId, owned, options)
      checkCancelled(options.signal)
      return result
    },
    evidence: async (reference, options = {}) => {
      validateEvidenceOptions(options)
      checkCancelled(options.signal)
      const api = await load()
      checkCancelled(options.signal)
      const owned = ownedReference(api, reference)
      const result = await api.readMeetingEvidence(meetings, accountId, owned, {
        cues: options.cues,
        bytes: options.bytes,
        signal: options.signal,
        after: options.after === undefined ? undefined : ownedReference(api, options.after),
        afterTranscriptId: options.afterTranscriptId,
        maxReadBytes: options.maxReadBytes,
        maxTranscriptPages: options.maxTranscriptPages,
      })
      checkCancelled(options.signal)
      return result
    },
    personContext: async (person, options = {}) => {
      validatePersonContext(person, options)
      checkCancelled(options.signal)
      const api = await load()
      checkCancelled(options.signal)
      const personStore: PersonMeetingReadStore = {
        people: store.people,
        involvements: store.involvements,
        meetings,
      }
      const result = await api.personMeetingContext(personStore, person, {
        accountIds: [accountId],
        meetings: options.meetings,
        cues: options.cues,
        bytes: options.bytes,
        scanLimit: options.scanLimit,
        since: options.since,
        signal: options.signal,
      })
      checkCancelled(options.signal)
      return result
    },
    taskProposal: async (reference, kind, signal) => {
      validateTaskKind(kind)
      checkCancelled(signal)
      const api = await load()
      checkCancelled(signal)
      const owned = ownedReference(api, reference)
      const result = await api.proposeMeetingTask(meetings, accountId, owned, kind)
      checkCancelled(signal)
      validateTaskProposal(result)
      return result
    },
  }
}
