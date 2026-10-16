import type { KeyringStore, Logger } from "@wirecat/cli-base"
import { CliError, isCliError } from "@wirecat/cli-base"
import { checkCancelled, object } from "./errors.js"

export interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
}
export interface TokenOptions {
  clientId: string
  keyring: KeyringStore
  service: string
  fetch: typeof fetch
  now?: () => number
  signal?: AbortSignal
  log?: Logger
}
/** Keys a token record carries beyond cli-base's own; names only, nothing from the token itself. */
export const TOKEN_LOG_ALLOW = ["rotated", "saved", "pid"] as const
export const TOKEN_LOG_EVENT = "zoom.token.exchange"
// The command deadline aborts with a "timeout" CliError and Ctrl-C with "cancelled"; without a
// parent abort, only the request's own 30 s limit can have fired.
const abortReason = (parent?: AbortSignal): string =>
  !parent?.aborted ? "timeout" : isCliError(parent.reason) ? parent.reason.code : "cancelled"
export class TokenManager {
  private refreshState = new Map<string, Promise<Tokens>>()
  constructor(readonly options: TokenOptions) {}
  withSignal(signal?: AbortSignal, fetcher: typeof fetch = this.options.fetch): TokenManager {
    const parent = this.options
    let clientId: string | undefined
    const scoped = new TokenManager({
      get clientId() {
        clientId ??= parent.clientId
        return clientId
      },
      keyring: parent.keyring,
      service: parent.service,
      fetch: fetcher,
      now: parent.now,
      log: parent.log,
      signal: signal && parent.signal ? AbortSignal.any([signal, parent.signal]) : (signal ?? parent.signal),
    })
    scoped.refreshState = this.refreshState
    return scoped
  }
  load(clientId = this.options.clientId): Tokens | null {
    let saved: string | null
    try {
      saved = this.options.keyring.get(this.options.service, clientId)
    } catch {
      throw new CliError("configuration_error", "system keyring is unavailable")
    }
    if (!saved) return null
    try {
      const value = object(JSON.parse(saved))
      if (
        typeof value.accessToken !== "string" ||
        !value.accessToken ||
        typeof value.refreshToken !== "string" ||
        !value.refreshToken ||
        typeof value.expiresAt !== "number" ||
        !Number.isFinite(value.expiresAt) ||
        !Array.isArray(value.scopes) ||
        !value.scopes.every((s) => typeof s === "string")
      )
        throw new Error("invalid token entry")
      return {
        accessToken: value.accessToken,
        refreshToken: value.refreshToken,
        expiresAt: value.expiresAt,
        scopes: value.scopes,
      }
    } catch {
      throw new CliError("authentication_error", "saved login is invalid; run zm session start again")
    }
  }
  save(tokens: Tokens, clientId = this.options.clientId): void {
    try {
      this.options.keyring.set(this.options.service, clientId, JSON.stringify(tokens))
    } catch {
      throw new CliError("configuration_error", "could not save login to the system keyring")
    }
  }
  async exchange(params: Record<string, string>, previous?: Tokens, clientId = this.options.clientId): Promise<Tokens> {
    checkCancelled(this.options.signal)
    const signal = this.options.signal
      ? AbortSignal.any([this.options.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000)
    const parent = this.options.signal
    const record = (level: keyof Logger, fields: Record<string, unknown>) =>
      this.options.log?.[level]({
        event: TOKEN_LOG_EVENT,
        operation: params.grant_type ?? "unknown",
        pid: process.pid,
        ...(signal.aborted ? { reason: abortReason(parent) } : {}),
        ...fields,
      })
    let response: Response
    try {
      response = await this.options.fetch("https://zoom.us/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...params, client_id: clientId }),
        signal,
        redirect: "error",
      })
    } catch {
      record("warn", { outcome: "no_response" })
      throw new CliError(
        "outcome_unknown",
        "Zoom token exchange did not finish; run zm session start again before retrying",
      )
    }
    if (!response.ok) {
      record("warn", { outcome: "rejected", status: response.status })
      throw new CliError(
        "authentication_error",
        `Zoom token request failed (HTTP ${response.status}); run zm session start again`,
      )
    }
    let body: Record<string, unknown>
    try {
      body = object(await response.json())
    } catch {
      record("error", { outcome: "unreadable_response", status: response.status })
      throw new CliError(
        "outcome_unknown",
        "Zoom returned an invalid token response; run zm session start again before retrying",
      )
    }
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : previous?.refreshToken
    if (
      typeof body.access_token !== "string" ||
      !body.access_token ||
      !refreshToken ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0 ||
      !Number.isFinite((this.options.now?.() ?? Date.now()) + body.expires_in * 1000) ||
      (body.scope !== undefined && typeof body.scope !== "string") ||
      (body.refresh_token !== undefined && typeof body.refresh_token !== "string")
    ) {
      record("error", { outcome: "invalid_response", status: response.status })
      throw new CliError(
        "outcome_unknown",
        "Zoom returned an invalid token response; run zm session start again before retrying",
      )
    }
    const rotated = previous ? { rotated: refreshToken !== previous.refreshToken } : {}
    const tokens = {
      accessToken: body.access_token,
      refreshToken,
      expiresAt: (this.options.now?.() ?? Date.now()) + body.expires_in * 1000,
      scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : (previous?.scopes ?? []),
    }
    try {
      this.save(tokens, clientId)
    } catch (error) {
      record("error", { outcome: "save_failed", status: response.status, ...rotated, saved: false })
      throw error
    }
    record("info", { outcome: "saved", status: response.status, ...rotated, saved: true })
    return tokens
  }
  async tokens(): Promise<Tokens> {
    checkCancelled(this.options.signal)
    const clientId = this.options.clientId
    const saved = this.load(clientId)
    if (!saved) throw new CliError("authentication_error", "run zm session start first")
    if (saved.expiresAt > (this.options.now?.() ?? Date.now()) + 30000) return saved
    let refreshing = this.refreshState.get(clientId)
    if (!refreshing) {
      refreshing = this.exchange(
        { grant_type: "refresh_token", refresh_token: saved.refreshToken },
        saved,
        clientId,
      ).finally(() => {
        this.refreshState.delete(clientId)
      })
      this.refreshState.set(clientId, refreshing)
    }
    const refreshed = await refreshing
    checkCancelled(this.options.signal)
    return refreshed
  }
}
