import { CliError } from "@wirecat/cli-base"
import type { SearchAllFound, SearchAllRequest } from "@wirecat/cli-core/services"
import { checkCancelled } from "./errors.js"

export type UnifiedSearchRequest = Pick<SearchAllRequest, "text" | "limit" | "offset" | "only" | "exact" | "signal">
export type UnifiedSearch = (request: UnifiedSearchRequest) => Promise<SearchAllFound>
const resources = ["messages", "mail", "notes", "meetings"] as const
export const validateUnifiedSearch = (input: UnifiedSearchRequest, meetingsOnly = false): UnifiedSearchRequest => {
  const limit = input.limit ?? 100
  const only = input.only ?? ["meetings"]
  if (
    typeof input.text !== "string" ||
    !input.text.trim() ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) ||
    !Array.isArray(only) ||
    !only.length ||
    only.some((resource) => !(resources as readonly string[]).includes(resource)) ||
    (meetingsOnly && (only.length !== 1 || only[0] !== "meetings")) ||
    (input.exact !== undefined && typeof input.exact !== "boolean")
  )
    throw new CliError(
      "validation_error",
      "expected nonempty search text, supported resources and a limit from 1 through 1000",
    )
  return {
    text: input.text,
    limit,
    only: [...new Set(only)],
    ...(input.offset === undefined ? {} : { offset: input.offset }),
    exact: input.exact,
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
