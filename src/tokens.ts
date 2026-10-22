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
  /** The keyring account the login lives under; the client id when unset. */
  account?: string
  /** Where a login saved before profiles were words lives, read once and moved to `account`. */
  legacyAccount?: string
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
  /** The login of one profile: `<client id>:<profile>` in the keyring. */
  forProfile(profile: string, legacyProfile: string | null): TokenManager {
    const parent = this.options
    const scoped = new TokenManager({
      get clientId() {
        return parent.clientId
      },
      get account() {
        return `${parent.clientId}:${profile}`
      },
      get legacyAccount() {
        return profile === legacyProfile ? parent.clientId : undefined
      },
      keyring: parent.keyring,
      service: parent.service,
      fetch: parent.fetch,
      now: parent.now,
      log: parent.log,
      signal: parent.signal,
    })
    scoped.refreshState = this.refreshState
    return scoped
  }
  withSignal(signal?: AbortSignal, fetcher: typeof fetch = this.options.fetch): TokenManager {
    const parent = this.options
    // The account is built from the client id, so both are fixed together on first use.
    let login: Pick<TokenOptions, "clientId" | "account" | "legacyAccount"> | undefined
    const pinned = () =>
      (login ??= { clientId: parent.clientId, account: parent.account, legacyAccount: parent.legacyAccount })
    const scoped = new TokenManager({
      get clientId() {
        return pinned().clientId
      },
      get account() {
        return pinned().account
      },
      get legacyAccount() {
        return pinned().legacyAccount
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
  private accountOf(): string {
    return this.options.account ?? this.options.clientId
  }
  private read(account: string): string | null {
    try {
      return this.options.keyring.get(this.options.service, account)
    } catch {
      throw new CliError("configuration_error", "system keyring is unavailable")
    }
  }
  load(account = this.accountOf()): Tokens | null {
    let saved = this.read(account)
    const legacy = account === this.options.account ? this.options.legacyAccount : undefined
    let moved = false
    if (!saved && legacy) {
      saved = this.read(legacy)
      moved = saved !== null
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
      const tokens = {
        accessToken: value.accessToken,
        refreshToken: value.refreshToken,
        expiresAt: value.expiresAt,
        scopes: value.scopes,
      }
      if (moved) this.save(tokens, account)
      return tokens
    } catch (error) {
      if (isCliError(error) && error.code === "configuration_error") throw error
      throw new CliError("authentication_error", "saved login is invalid; run zm <profile> session start again")
    }
  }
  save(tokens: Tokens, account = this.accountOf()): void {
    try {
      this.options.keyring.set(this.options.service, account, JSON.stringify(tokens))
    } catch {
      throw new CliError("configuration_error", "could not save login to the system keyring")
    }
  }
  async exchange(
    params: Record<string, string>,
    previous?: Tokens,
    clientId = this.options.clientId,
    account = this.options.account ?? clientId,
  ): Promise<Tokens> {
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
        "Zoom token exchange did not finish; run zm <profile> session start again before retrying",
      )
    }
    if (!response.ok) {
      record("warn", { outcome: "rejected", status: response.status })
      throw new CliError(
        "authentication_error",
        `Zoom token request failed (HTTP ${response.status}); run zm <profile> session start again`,
      )
    }
    let body: Record<string, unknown>
    try {
      body = object(await response.json())
    } catch {
      record("error", { outcome: "unreadable_response", status: response.status })
      throw new CliError(
        "outcome_unknown",
        "Zoom returned an invalid token response; run zm <profile> session start again before retrying",
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
        "Zoom returned an invalid token response; run zm <profile> session start again before retrying",
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
      this.save(tokens, account)
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
    const account = this.options.account ?? clientId
    const saved = this.load(account)
    if (!saved) throw new CliError("authentication_error", "run zm <profile> session start first")
    if (saved.expiresAt > (this.options.now?.() ?? Date.now()) + 30000) return saved
    let refreshing = this.refreshState.get(account)
    if (!refreshing) {
      refreshing = this.exchange(
        { grant_type: "refresh_token", refresh_token: saved.refreshToken },
        saved,
        clientId,
        account,
      ).finally(() => {
        this.refreshState.delete(account)
      })
      this.refreshState.set(account, refreshing)
    }
    const refreshed = await refreshing
    checkCancelled(this.options.signal)
    return refreshed
  }
}
