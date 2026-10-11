import type { KeyringStore } from "@wirecat/cli-base"
import { checkCancelled, object, ZoomError } from "./errors.js"

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
}
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
      throw new ZoomError("configuration_error", "system keyring is unavailable")
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
      throw new ZoomError("authentication_error", "saved login is invalid; run zm login again")
    }
  }
  save(tokens: Tokens, clientId = this.options.clientId): void {
    try {
      this.options.keyring.set(this.options.service, clientId, JSON.stringify(tokens))
    } catch {
      throw new ZoomError("configuration_error", "could not save login to the system keyring")
    }
  }
  async exchange(params: Record<string, string>, previous?: Tokens, clientId = this.options.clientId): Promise<Tokens> {
    checkCancelled(this.options.signal)
    const signal = this.options.signal
      ? AbortSignal.any([this.options.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000)
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
      throw new ZoomError("outcome_unknown", "Zoom token exchange did not finish; run zm login again before retrying")
    }
    if (!response.ok)
      throw new ZoomError(
        "authentication_error",
        `Zoom token request failed (HTTP ${response.status}); run zm login again`,
      )
    let body: Record<string, unknown>
    try {
      body = object(await response.json())
    } catch {
      throw new ZoomError(
        "outcome_unknown",
        "Zoom returned an invalid token response; run zm login again before retrying",
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
    )
      throw new ZoomError(
        "outcome_unknown",
        "Zoom returned an invalid token response; run zm login again before retrying",
      )
    const tokens = {
      accessToken: body.access_token,
      refreshToken,
      expiresAt: (this.options.now?.() ?? Date.now()) + body.expires_in * 1000,
      scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : (previous?.scopes ?? []),
    }
    this.save(tokens, clientId)
    return tokens
  }
  async tokens(): Promise<Tokens> {
    checkCancelled(this.options.signal)
    const clientId = this.options.clientId
    const saved = this.load(clientId)
    if (!saved) throw new ZoomError("authentication_error", "run zm login first")
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
