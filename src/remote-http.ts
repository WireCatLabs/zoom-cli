import { setTimeout } from "node:timers/promises"
import { providerWaitMs, retryableStatus, statusToCode } from "@wirecat/cli-core/http"
import { checkCancelled, object, ZoomError } from "./errors.js"
import type { TokenManager } from "./tokens.js"

export interface RemoteOptions {
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}
export interface RemoteRequest {
  signal?: AbortSignal
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: unknown
}
export const operationSignal = (signal?: AbortSignal): AbortSignal => signal ?? AbortSignal.timeout(3600000)
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
        throw new ZoomError("network_error", "Zoom request could not be completed")
      }
      if (retry && attempt < 2 && retryableStatus(response.status) && (await this.pause(response, attempt, signal))) {
        await response.body?.cancel()
        continue
      }
      return response
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
    const signal = operationSignal(options.signal)
    checkCancelled(signal)
    const tokens = await this.tokens.tokens()
    if (![scope, `${scope}:admin`, `${scope}:master`].some((grant) => tokens.scopes.includes(grant)))
      throw new ZoomError(
        "configuration_error",
        `Zoom scope ${scope} is missing; add it to the app and run zm login again`,
      )
    checkCancelled(signal)
    const method = options.method ?? "GET"
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
        throw new ZoomError("outcome_unknown", "Zoom mutation did not finish; verify remote state before retrying")
      }
    }
    if (response.status === 204) return {}
    let value: unknown
    try {
      value = await response.json()
    } catch {
      if (response.ok)
        throw new ZoomError(
          method === "GET" ? "invalid_response" : "outcome_unknown",
          method === "GET"
            ? "Zoom returned an invalid response"
            : "Zoom mutation returned an invalid response; verify remote state before retrying",
        )
      value = {}
    }
    const body = typeof value === "object" && value !== null && !Array.isArray(value) ? object(value) : {}
    if (body.code === 4711)
      throw new ZoomError(
        "authentication_error",
        `Zoom scope ${scope} is missing; add it to the app and run zm login again`,
      )
    if (response.status === 404 && missingCode !== undefined && body.code === missingCode) return null
    if (!response.ok || (typeof body.code === "number" && body.code !== 0))
      throw new ZoomError(
        body.code === 200 ? "permission_error" : statusToCode(response.status),
        `Zoom request failed (HTTP ${response.status}${typeof body.code === "number" ? `, code ${body.code}` : ""})`,
      )
    try {
      return object(value)
    } catch {
      throw new ZoomError(
        method === "GET" ? "invalid_response" : "outcome_unknown",
        method === "GET"
          ? "Zoom returned an invalid response"
          : "Zoom mutation returned an invalid response; verify remote state before retrying",
      )
    }
  }
}
