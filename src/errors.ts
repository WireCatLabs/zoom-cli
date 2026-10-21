import { CliError, isCliError } from "@wirecat/cli-base"

export const checkCancelled = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return
  if (isCliError(signal.reason)) throw signal.reason
  const timedOut = signal.reason instanceof Error && signal.reason.name === "TimeoutError"
  throw new CliError(timedOut ? "timeout" : "cancelled", timedOut ? "command timed out" : "command cancelled")
}
export const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new CliError("invalid_response", "Zoom returned an invalid response")
  return value as Record<string, unknown>
}
export const string = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null)
export const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null
/** Epoch ms of a Zoom date-time, which must name its zone: a time without one would be read in the process zone. */
export const zoomInstant = (text: string, message: string): number => {
  const invalid = () => new CliError("invalid_response", message)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) throw invalid()
  const local = text.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "Z")
  const date = new Date(local)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== local.slice(0, 19)) throw invalid()
  const stamp = Date.parse(text)
  if (!Number.isSafeInteger(stamp)) throw invalid()
  return stamp
}
