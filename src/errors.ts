import { CliError, type ErrorCode, isCliError } from "@wirecat/cli-base"

export class ZoomError extends CliError {
  constructor(code: ErrorCode, message: string) {
    super(code, message)
  }
}
export const checkCancelled = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return
  if (isCliError(signal.reason)) throw signal.reason
  const timedOut = signal.reason instanceof Error && signal.reason.name === "TimeoutError"
  throw new ZoomError(timedOut ? "timeout" : "cancelled", timedOut ? "command timed out" : "command cancelled")
}
export const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ZoomError("invalid_response", "Zoom returned an invalid response")
  return value as Record<string, unknown>
}
export const string = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null)
export const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null
