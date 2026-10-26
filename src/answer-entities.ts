import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { answerEntity, type Body, MEETING_RESULT_ENTITIES, meetingResultItem } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import * as v from "valibot"

const text = v.string()
const identifier = v.pipe(text, v.minLength(1))
const nullableText = v.nullable(text)
const count = v.pipe(v.number(), v.integer(), v.minValue(0))
const flag = v.boolean()
const optionalCount = v.optional(count)
const scope = v.strictObject({ provider: text, account: text })
const asset = v.strictObject({
  id: nullableText,
  type: text,
  format: nullableText,
  size: v.nullable(count),
  status: text,
  available: flag,
  started_at: nullableText,
  ended_at: nullableText,
})
const occurrence = v.strictObject({ id: text, uuid: text, title: nullableText, started_at: nullableText })
const recording = v.strictObject({ ...occurrence.entries, assets: v.array(asset) })
const archivedFile = v.strictObject({
  id: text,
  path: text,
  size: count,
  sha256: text,
  remote_size: v.nullable(count),
  type: text,
  format: nullableText,
  started_at: nullableText,
  ended_at: nullableText,
})
const archive = v.strictObject({
  uuid: text,
  manifest_path: text,
  downloaded: v.array(archivedFile),
  skipped: v.array(archivedFile),
  unavailable: v.array(asset),
})
const manifest = v.strictObject({ version: v.literal(1), meeting: occurrence, files: v.array(archivedFile) })
const lock = v.strictObject({
  name: text,
  status: v.picklist(["active", "stale", "foreign", "unrecognized"]),
  pid: v.nullable(count),
  host: nullableText,
})
const archiveReceipt = v.strictObject({
  window: v.strictObject({ from: text, to: text }),
  meeting: v.strictObject({ id: text, uuid: text, title: nullableText }),
  archive,
  availability: v.optional(v.literal("unknown")),
  checkpoint_revision: v.optional(v.nullable(count)),
})
const remote = v.strictObject({
  id: text,
  uuid: nullableText,
  title: nullableText,
  type: v.nullable(v.number()),
  started_at: nullableText,
  duration_minutes: v.nullable(v.number()),
  timezone: nullableText,
  agenda: nullableText,
  join_url: nullableText,
})
const remoteChange = v.strictObject({
  action: v.picklist(["create", "update", "cancel"]),
  applied: flag,
  request: v.strictObject({
    method: v.picklist(["POST", "PATCH", "DELETE"]),
    path: text,
    body: v.optional(v.record(text, v.union([text, v.number()]))),
  }),
  meeting: v.optional(remote),
})
const schedule = v.strictObject({
  version: v.literal(1),
  id: text,
  name: text,
  scope,
  destination: text,
  from: text,
  daily_at: text,
  time_zone: text,
  lookback_days: count,
  max_bytes: count,
  created_at: v.pipe(text, v.isoTimestamp()),
})
const job = v.strictObject({
  version: v.literal(1),
  schedule,
  capture: v.strictObject({ profile: text, client_id: text, config_dir: text, runtime: text, cli_path: text }),
  state: v.picklist(["pending", "enabled", "disabled"]),
})
const scheduleReceipt = v.strictObject({
  applied: flag,
  backend: text,
  job,
  units: v.optional(v.strictObject({ service_name: text, timer_name: text, service: text, timer: text })),
  timer_state: v.picklist(["not_checked", "verified_enabled", "verified_disabled"]),
})
const cue = v.strictObject({ start_ms: count, end_ms: count, speaker: nullableText, text })
const archiveImport = v.strictObject({
  uuid: text,
  asset_ids: v.array(text),
  status: v.picklist(["acknowledged", "unavailable"]),
  meeting_id: v.optional(identifier),
  created: v.optional(flag),
  inserted_transcripts: optionalCount,
  replayed_transcripts: optionalCount,
  superseded_transcripts: optionalCount,
  reason: v.optional(v.literal("missing_or_deleted")),
})
const searchHit = v.strictObject({
  source: text,
  id: nullableText,
  title: nullableText,
  time: nullableText,
  text: nullableText,
  url: nullableText,
  people: v.array(text),
  container_id: nullableText,
  details: v.record(text, v.nullable(v.union([text, v.number(), flag]))),
})
export const ZOOM_ANSWER_ENTITIES = {
  "recordings list": { name: "zoom_recording", schema: recording },
  "recordings show": { name: "zoom_recording", schema: recording },
  "recordings download": { name: "zoom_archive", schema: v.union([archive, archiveReceipt]) },
  "recordings archive show": { name: "zoom_archive_manifest", schema: manifest },
  "recordings archive check": {
    name: "zoom_archive_check",
    schema: v.strictObject({ manifest_path: text, id: text, path: text, valid: flag }),
  },
  "recordings archive locks": { name: "zoom_archive_lock", schema: lock },
  "recordings archive recover": {
    name: "zoom_archive_recovery",
    schema: v.strictObject({ locks: v.array(lock), removed: v.array(text) }),
  },
  "recordings archive transcript": {
    name: "zoom_archive_transcript",
    schema: v.strictObject({ meeting: occurrence, asset: archivedFile, cues: v.array(cue) }),
  },
  "recordings archive import": { name: "zoom_archive_import", schema: archiveImport },
  "recordings schedule list": { name: "zoom_archive_job", schema: job },
  "recordings schedule show": { name: "zoom_archive_job", schema: job },
  "recordings schedule create": { name: "zoom_archive_schedule_change", schema: scheduleReceipt },
  "recordings schedule disable": { name: "zoom_archive_schedule_change", schema: scheduleReceipt },
  "recordings schedule run": { name: "zoom_archive_receipt", schema: archiveReceipt },
  "remote-meetings list": { name: "zoom_remote_meeting", schema: remote },
  "remote-meetings show": { name: "zoom_remote_meeting", schema: remote },
  "remote-meetings invitation": {
    name: "zoom_remote_invitation",
    schema: v.strictObject({ id: text, invitation: text }),
  },
  "remote-meetings create": { name: "zoom_remote_change", schema: remoteChange },
  "remote-meetings update": { name: "zoom_remote_change", schema: remoteChange },
  "remote-meetings cancel": { name: "zoom_remote_change", schema: remoteChange },
  "zoom search": { name: "zoom_search_hit", schema: searchHit },
  "meetings embeddings": { name: "meeting_embedding", schema: MEETING_RESULT_ENTITIES.meeting_embedding, shared: true },
  "meetings sync": { name: "meeting_ingestion", schema: MEETING_RESULT_ENTITIES.meeting_ingestion, shared: true },
  "meetings import": { name: "meeting_ingestion", schema: MEETING_RESULT_ENTITIES.meeting_ingestion, shared: true },
  watch: { name: "meeting_ingestion", schema: MEETING_RESULT_ENTITIES.meeting_ingestion, shared: true },
  "meetings export": { name: "meeting_export", schema: MEETING_RESULT_ENTITIES.meeting_export, shared: true },
  "meetings update": { name: "meeting_association", schema: MEETING_RESULT_ENTITIES.meeting_association, shared: true },
  "meetings link": { name: "meeting_association", schema: MEETING_RESULT_ENTITIES.meeting_association, shared: true },
  "meetings transcribe": {
    name: "meeting_transcription",
    schema: MEETING_RESULT_ENTITIES.meeting_transcription,
    shared: true,
  },
} satisfies Record<string, { name: string; schema: v.GenericSchema; shared?: boolean }>

export const declareZoomAnswers = (program: Command): void => {
  const walk = (command: Command, path: string[]) => {
    const entity = (
      ZOOM_ANSWER_ENTITIES as Record<string, { name: string; schema: v.GenericSchema; shared?: boolean }>
    )[path.join(" ")]
    if (entity?.shared) annotate(command, { output: { entity: entity.name } })
    else if (entity) answerEntity(command, entity.name, entity.schema)
    for (const child of command.commands) walk(child, [...path, child.name()])
  }
  walk(program, [])
}

const publicValue = (value: unknown, key = ""): unknown => {
  if (typeof value === "number" && key === "meeting_id") return String(value)
  if (typeof value === "number" && key === "created_at") return new Date(value).toISOString()
  if (Array.isArray(value)) return value.map((item) => publicValue(item))
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, publicValue(item, name)]))
  return value
}

const schemas = new Map(Object.values(ZOOM_ANSWER_ENTITIES).map(({ name, schema }) => [name, schema]))
export const normalizeZoomAnswer = (body: Body, entity?: string): Body => {
  const schema = entity ? schemas.get(entity) : undefined
  if (!schema) return body
  const checked = (value: unknown) => {
    if (entity && Object.hasOwn(MEETING_RESULT_ENTITIES, entity))
      return meetingResultItem(entity as keyof typeof MEETING_RESULT_ENTITIES, value)
    const parsed = v.safeParse(schema, publicValue(value))
    if (!parsed.success) {
      const applied = value && typeof value === "object" && "applied" in value && value.applied === true
      throw new CliError(
        applied ? "outcome_unknown" : "invalid_response",
        `the command returned an invalid ${entity} answer`,
      )
    }
    return parsed.output
  }
  return "item" in body ? { ...body, item: checked(body.item) } : { ...body, items: body.items.map(checked) }
}
