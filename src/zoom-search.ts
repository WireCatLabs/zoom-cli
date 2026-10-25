import { CliError } from "@wirecat/cli-base"
import type { TokenManager } from "./tokens.js"
import { ZoomMcp } from "./zoom-mcp.js"

export const ZOOM_SEARCH_SCOPE = "agentic_search:read:search"
/** Our words for Zoom's datasources. */
export const ZOOM_SEARCH_SOURCES = {
  meetings: "zoom_meeting",
  calendar: "calendar",
  chat: "zoom_chat_message",
  channels: "zoom_chat_session",
  docs: "zoom_canvas",
  notes: "zoom_my_notes",
  calls: "zoom_phone_call",
  sms: "zoom_phone_sms",
  voicemail: "zoom_phone_voicemail",
} as const
export type ZoomSearchSource = keyof typeof ZOOM_SEARCH_SOURCES
const SOURCE_OF = new Map<string, string>(Object.entries(ZOOM_SEARCH_SOURCES).map(([word, name]) => [name, word]))

export interface ZoomSearchHit {
  source: string
  id: string | null
  title: string | null
  time: string | null
  text: string | null
  url: string | null
  people: string[]
  /** The chat a message is in. */
  container_id: string | null
  details: Record<string, string | number | boolean | null>
}
export interface ZoomSearchPage {
  items: ZoomSearchHit[]
  has_more: boolean
  cursor?: string
}
export interface ZoomSearchRequest {
  query?: string
  sources?: ZoomSearchSource[]
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""
const first = (row: Record<string, unknown>, keys: string[]) => keys.map((key) => row[key]).find(filled) ?? null

const ID_KEYS = ["meeting_uuid", "message_id", "session_id", "file_id", "note_id", "call_id", "event_id", "id"]
const TITLE_KEYS = ["topic", "title", "session_name", "subject", "name", "file_name"]
const TIME_KEYS = ["meeting_start_time", "sent_time", "start_time", "modify_time", "created_time", "create_time"]
const CHUNK_KEYS = ["chunks", "call_summary_chunks", "transcript_chunks"]

const chunkText = (row: Record<string, unknown>) => {
  const parts = CHUNK_KEYS.flatMap((key) => (Array.isArray(row[key]) ? (row[key] as unknown[]) : [])).flatMap(
    (chunk) => {
      if (filled(chunk)) return [chunk]
      if (record(chunk)) return [first(chunk, ["text", "content", "chunk"])].filter(filled)
      return []
    },
  )
  return parts.length ? parts.join("\n") : null
}
const peopleOf = (row: Record<string, unknown>) => {
  const list = Array.isArray(row.attendees) ? row.attendees : Array.isArray(row.attendee_list) ? row.attendee_list : []
  return list.flatMap((person) => {
    const name = record(person) ? first(person, ["display_name", "user_name", "name"]) : null
    return name ? [name] : []
  })
}

const hitOf = (row: Record<string, unknown>, source: string, container: string | null = null): ZoomSearchHit => {
  const id =
    first(row, ID_KEYS) ??
    (Object.entries(row).find(([key, value]) => key.endsWith("_id") && filled(value))?.[1] as string | undefined) ??
    null
  const time =
    first(row, TIME_KEYS) ??
    (Object.entries(row).find(([key, value]) => key.endsWith("_time") && filled(value))?.[1] as string | undefined) ??
    null
  const details: ZoomSearchHit["details"] = {}
  for (const [key, value] of Object.entries(row))
    if (key !== "datasource" && (value === null || ["string", "number", "boolean"].includes(typeof value)))
      details[key] = value as string | number | boolean | null
  return {
    source,
    id,
    title: first(row, TITLE_KEYS),
    time,
    text: first(row, ["message", "text", "snippet"]) ?? chunkText(row),
    url: first(row, ["link", "url", "join_url"]),
    people: peopleOf(row),
    container_id: container,
    details,
  }
}

/** One Zoom row can be one chat holding several matching messages; each message is its own hit. */
export const zoomSearchHits = (rows: unknown[]): ZoomSearchHit[] =>
  rows.flatMap((row) => {
    if (!record(row)) throw new CliError("invalid_response", "Zoom returned an invalid search result")
    const name = filled(row.datasource) ? row.datasource : "unknown"
    const source = SOURCE_OF.get(name) ?? name
    if (name === "zoom_chat_message" && Array.isArray(row.messages)) {
      const chat = filled(row.session_id) ? row.session_id : null
      return row.messages.filter(record).map((message) => {
        const hit = hitOf(message, source, chat)
        return { ...hit, title: hit.title ?? first(row, ["session_name"]) }
      })
    }
    return [hitOf(row, source)]
  })

export class ZoomSearch {
  readonly mcp: ZoomMcp
  constructor(tokens: Pick<TokenManager, "tokens">, fetcher: typeof fetch) {
    this.mcp = new ZoomMcp(tokens, fetcher)
  }
  async search(request: ZoomSearchRequest): Promise<ZoomSearchPage> {
    const args: Record<string, unknown> = { page_size: request.limit ?? 10 }
    if (request.query?.trim()) args.query = request.query.trim()
    if (request.sources?.length)
      args.datasource_filters = request.sources.map((source) => ({ datasource: ZOOM_SEARCH_SOURCES[source] }))
    if (request.cursor) args.next_page_token = request.cursor
    const body = await this.mcp.call("search", args, ZOOM_SEARCH_SCOPE, request.signal)
    if (!record(body) || !Array.isArray(body.data))
      throw new CliError("invalid_response", "Zoom returned an invalid search answer")
    const cursor = filled(body.next_page_token) ? body.next_page_token : undefined
    return { items: zoomSearchHits(body.data), has_more: body.has_more === true, ...(cursor ? { cursor } : {}) }
  }
}
