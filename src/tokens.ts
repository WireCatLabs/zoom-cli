import { CliError, type KeyringStore } from "@wirecat/cli-core"
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
  private refreshState: { refreshing?: Promise<Tokens> } = {}
  constructor(readonly options: TokenOptions) {}
  withSignal(signal?: AbortSignal, fetcher: typeof fetch = this.options.fetch): TokenManager {
    const parent = this.options
    const scoped = new TokenManager({
      get clientId() {
        return parent.clientId
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
  load(): Tokens | null {
    let saved: string | null
    try {
      saved = this.options.keyring.get(this.options.service, this.options.clientId)
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
  save(tokens: Tokens): void {
    try {
      this.options.keyring.set(this.options.service, this.options.clientId, JSON.stringify(tokens))
    } catch {
      throw new ZoomError("configuration_error", "could not save login to the system keyring")
    }
  }
  async exchange(params: Record<string, string>, previous?: Tokens): Promise<Tokens> {
    checkCancelled(this.options.signal)
    const signal = this.options.signal
      ? AbortSignal.any([this.options.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000)
    let response: Response
    try {
      response = await this.options.fetch("https://zoom.us/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...params, client_id: this.options.clientId }),
        signal,
        redirect: "error",
      })
    } catch (error) {
      if (error instanceof CliError) throw error
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
      throw new ZoomError("invalid_response", "Zoom returned an invalid token response")
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
      throw new ZoomError("invalid_response", "Zoom returned an invalid token response")
    const tokens = {
      accessToken: body.access_token,
      refreshToken,
      expiresAt: (this.options.now?.() ?? Date.now()) + body.expires_in * 1000,
      scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : (previous?.scopes ?? []),
    }
    this.save(tokens)
    return tokens
  }
  async tokens(): Promise<Tokens> {
    checkCancelled(this.options.signal)
    const saved = this.load()
    if (!saved) throw new ZoomError("authentication_error", "run zm login first")
    if (saved.expiresAt > (this.options.now?.() ?? Date.now()) + 30000) return saved
    this.refreshState.refreshing ??= this.exchange(
      { grant_type: "refresh_token", refresh_token: saved.refreshToken },
      saved,
    ).finally(() => {
      this.refreshState.refreshing = undefined
    })
    const refreshed = await this.refreshState.refreshing
    checkCancelled(this.options.signal)
    return refreshed
  }
}
