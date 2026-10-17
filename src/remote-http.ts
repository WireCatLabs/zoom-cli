import { setTimeout } from "node:timers/promises"
import { CliError, isCliError } from "@wirecat/cli-base"
import { providerWaitMs, readJsonResponse, retryableStatus, statusToCode } from "@wirecat/cli-base/http"
import { checkCancelled, object } from "./errors.js"
import type { TokenManager } from "./tokens.js"

export interface RemoteOptions {
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}
export interface RemoteRequest {
  signal?: AbortSignal
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: unknown
  maxResponseBytes?: number
}
export interface DownloadRequest {
  accessToken: string
  signal: AbortSignal
  /** The noun in the error messages: "transcript" or "recording". */
  what: string
  headers?: Record<string, string>
  /** The error for a request that could not be sent or answered; it may throw a cancellation instead. */
  unreachable: () => CliError
}
export const operationSignal = (signal?: AbortSignal): AbortSignal => signal ?? AbortSignal.timeout(3600000)
const downloadTarget = (input: string, what: string, base?: URL): URL => {
  let target: URL
  try {
    target = new URL(input, base)
  } catch {
    throw new CliError("invalid_response", `Zoom returned an unexpected ${what} download host`)
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443") ||
    !/(^|\.)zoom\.(us|com)$/.test(target.hostname)
  )
    throw new CliError("invalid_response", `Zoom returned an unexpected ${what} download host`)
  return target
}
export class ZoomRemote {
  constructor(
    readonly tokens: Pick<TokenManager, "tokens">,
    readonly fetcher: typeof fetch,
    private readonly options: RemoteOptions = {},
  ) {}
  async pause(response: Response | null, attempt: number, signal: AbortSignal): Promise<boolean> {
    const delay = response
      ? (providerWaitMs(response.headers, () => new Date(this.options.now?.() ?? Date.now())) ?? 250 * 2 ** attempt)
      : 250 * 2 ** attempt
    if (!Number.isFinite(delay) || delay > 30000) return false
    checkCancelled(signal)
    await (this.options.sleep ?? ((ms, abort) => setTimeout(ms, undefined, { signal: abort })))(
      Math.max(0, delay),
      signal,
    )
    return true
  }
  async get(target: string | URL, accessToken: string, signal: AbortSignal, retry = true): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      checkCancelled(signal)
      let response: Response
      try {
        response = await this.fetcher(target, {
          headers: { authorization: `Bearer ${accessToken}` },
          redirect: "manual",
          signal,
        })
      } catch {
        checkCancelled(signal)
        if (retry && attempt < 2 && (await this.pause(null, attempt, signal))) continue
        throw new CliError("network_error", "Zoom request could not be completed")
      }
      if (retry && attempt < 2 && retryableStatus(response.status) && (await this.pause(response, attempt, signal))) {
        await response.body?.cancel()
        continue
      }
      return response
    }
  }
  /** Follows Zoom's redirects to a file, checking every hop's host; the caller judges the final response. */
  async download(url: string, request: DownloadRequest): Promise<Response> {
    const { accessToken, signal, what, headers = {}, unreachable } = request
    let target = downloadTarget(url, what)
    for (let redirects = 0; ; redirects++) {
      let response: Response
      try {
        if (signal.aborted) throw signal.reason
        response = await this.fetcher(target, {
          headers: { authorization: `Bearer ${accessToken}`, ...headers },
          redirect: "manual",
          signal,
        })
      } catch {
        throw unreachable()
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      const location = response.headers.get("location")
      await response.body?.cancel()
      if (!location || redirects >= 5) throw new CliError("invalid_response", `Zoom returned invalid ${what} redirects`)
      target = downloadTarget(location, what, target)
    }
  }
  request(path: string, scope: string, options: RemoteRequest = {}): Promise<Record<string, unknown>> {
    return this.perform(path, scope, options) as Promise<Record<string, unknown>>
  }
  requestOptional(
    path: string,
    scope: string,
    missingCode: number,
    options: RemoteRequest = {},
  ): Promise<Record<string, unknown> | null> {
    return this.perform(path, scope, options, missingCode)
  }
  private async perform(
    path: string,
    scope: string,
    options: RemoteRequest,
    missingCode?: number,
  ): Promise<Record<string, unknown> | null> {
    const method = options.method ?? "GET"
    if (
      options.maxResponseBytes !== undefined &&
      (method !== "GET" || !Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1)
    )
      throw new CliError("validation_error", "maxResponseBytes requires GET and a positive safe integer")
    const signal = operationSignal(options.signal)
    checkCancelled(signal)
    const tokens = await this.tokens.tokens()
    if (![scope, `${scope}:admin`, `${scope}:master`].some((grant) => tokens.scopes.includes(grant)))
      throw new CliError(
        "configuration_error",
        `Zoom scope ${scope} is missing; add it to the app and run zm session start again`,
      )
    checkCancelled(signal)
    let response: Response
    if (method === "GET") response = await this.get(`https://api.zoom.us/v2${path}`, tokens.accessToken, signal)
    else {
      try {
        response = await this.fetcher(`https://api.zoom.us/v2${path}`, {
          method,
          headers: { authorization: `Bearer ${tokens.accessToken}`, "content-type": "application/json" },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          redirect: "manual",
          signal,
        })
      } catch {
        throw new CliError("outcome_unknown", "Zoom mutation did not finish; verify remote state before retrying")
      }
    }
    if (method !== "GET" && signal.aborted)
      throw new CliError(
        "outcome_unknown",
        "Zoom mutation was interrupted after dispatch; verify remote state before retrying",
      )
    if (response.status === 204) return {}
    let value: unknown
    try {
      value =
        options.maxResponseBytes === undefined
          ? await response.json()
          : await readJsonResponse(response, { maxBytes: options.maxResponseBytes, signal })
    } catch (error) {
      if (method === "GET") {
        checkCancelled(signal)
        if (response.ok && isCliError(error)) throw error
      }
      if (response.ok)
        throw new CliError(
          method === "GET" ? "invalid_response" : "outcome_unknown",
          method === "GET"
            ? "Zoom returned an invalid response"
            : "Zoom mutation returned an invalid response; verify remote state before retrying",
        )
      value = {}
    }
    if (method !== "GET" && signal.aborted)
      throw new CliError(
        "outcome_unknown",
        "Zoom mutation was interrupted after dispatch; verify remote state before retrying",
      )
    const body = typeof value === "object" && value !== null && !Array.isArray(value) ? object(value) : {}
    if (body.code === 4711)
      throw new CliError(
        "authentication_error",
        `Zoom scope ${scope} is missing; add it to the app and run zm session start again`,
      )
    if (response.status === 404 && missingCode !== undefined && body.code === missingCode) return null
    if (!response.ok || (typeof body.code === "number" && body.code !== 0))
      throw new CliError(
        body.code === 200 ? "permission_error" : statusToCode(response.status),
        `Zoom request failed (HTTP ${response.status}${typeof body.code === "number" ? `, code ${body.code}` : ""})`,
      )
    try {
      return object(value)
    } catch {
      throw new CliError(
        method === "GET" ? "invalid_response" : "outcome_unknown",
        method === "GET"
          ? "Zoom returned an invalid response"
          : "Zoom mutation returned an invalid response; verify remote state before retrying",
      )
    }
  }
}
