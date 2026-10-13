import type { SearchAllIncludingMeetingsFound, SearchAllIncludingMeetingsRequest } from "@wirecat/cli-core/services"
import { checkCancelled, ZoomError } from "./errors.js"

export type UnifiedSearchRequest = Pick<
  SearchAllIncludingMeetingsRequest,
  "text" | "limit" | "only" | "exact" | "maxMeetings" | "meetingCursor" | "signal"
>
export type UnifiedSearch = (request: UnifiedSearchRequest) => Promise<SearchAllIncludingMeetingsFound>
const resources = ["messages", "mail", "notes", "meetings"] as const
export const validateUnifiedSearch = (input: UnifiedSearchRequest, meetingsOnly = false): UnifiedSearchRequest => {
  const limit = input.limit ?? 100
  const maxMeetings = input.maxMeetings ?? 100
  const only = input.only ?? ["meetings"]
  if (
    typeof input.text !== "string" ||
    !input.text.trim() ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    typeof maxMeetings !== "number" ||
    !Number.isSafeInteger(maxMeetings) ||
    maxMeetings < 1 ||
    maxMeetings > 1000 ||
    !Array.isArray(only) ||
    !only.length ||
    only.some((resource) => !resources.includes(resource)) ||
    (meetingsOnly && (only.length !== 1 || only[0] !== "meetings")) ||
    (input.exact !== undefined && typeof input.exact !== "boolean")
  )
    throw new ZoomError(
      "validation_error",
      "expected nonempty search text, supported resources and bounds from 1 through 1000",
    )
  if (input.meetingCursor !== undefined) {
    const cursor = input.meetingCursor
    if (
      typeof cursor !== "object" ||
      cursor === null ||
      Array.isArray(cursor) ||
      Object.keys(cursor).some((key) => !["accountId", "query", "meetingOffset", "hitOffset"].includes(key)) ||
      only.length !== 1 ||
      only[0] !== "meetings" ||
      typeof cursor.query !== "string" ||
      !cursor.query.trim() ||
      !Number.isSafeInteger(cursor.accountId) ||
      cursor.accountId < 1 ||
      !Number.isSafeInteger(cursor.meetingOffset) ||
      cursor.meetingOffset < 0 ||
      cursor.meetingOffset > Number.MAX_SAFE_INTEGER - 2 ||
      !Number.isSafeInteger(cursor.hitOffset) ||
      cursor.hitOffset < 0
    )
      throw new ZoomError(
        "validation_error",
        "meeting continuation requires a source-only cursor bound to its account and query",
      )
  }
  return {
    text: input.text,
    limit,
    maxMeetings,
    only: [...new Set(only)],
    exact: input.exact,
    meetingCursor: input.meetingCursor,
    signal: input.signal,
  }
}
export const runUnifiedSearch = async (search: UnifiedSearch, input: UnifiedSearchRequest, meetingsOnly = false) => {
  const request = validateUnifiedSearch(input, meetingsOnly)
  checkCancelled(request.signal)
  const result = await search(request)
  checkCancelled(request.signal)
  return result
}
