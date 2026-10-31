import type { KeyringStore, Logger } from "@wirecat/cli-base"
import { CliError, Credentials, isCliError } from "@wirecat/cli-base"
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
  keyring: KeyringStore
  service: string
  /**
   * The folder of the private file the login falls back to when the keyring fails (WC-SECR-4). Unset, the login is
   * kept in the keyring only.
   */
  configDir?: string
  /**
   * Where a new login goes, from `session start --credential-storage`. Unset, a refresh stays where the login is.
   * `keyring` falls back to the file when the keyring fails and drops a file copy when it does not.
   */
  storage?: "keyring" | "file"
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
type Stores = { auto: Credentials; file: Credentials; keyring: Credentials }

const storesOf = ({ configDir, service, keyring }: TokenOptions): Stores | undefined =>
  configDir === undefined
    ? undefined
    : {
        auto: new Credentials({ configDir, service, keyring }),
        file: new Credentials({ configDir, service, keyring, storage: "file" }),
        keyring: new Credentials({ configDir, service, keyring, storage: "keyring" }),
      }

export class TokenManager {
  private refreshState = new Map<string, Promise<Tokens>>()
  // Shared by every scoped manager, so a failing keyring is reported once per run.
  private stores: Stores | undefined
  constructor(readonly options: TokenOptions) {
    this.stores = storesOf(options)
  }
  /** Where this login is kept: the file once it holds it, the keyring otherwise. */
  storageOf(account = this.accountOf()): "keyring" | "file" {
    return this.stores?.file.read(account) ? "file" : "keyring"
  }
  /** The same login, saved where `session start --credential-storage` says. */
  storedIn(storage: "keyring" | "file"): TokenManager {
    const scoped = new TokenManager({ ...this.options, storage })
    scoped.refreshState = this.refreshState
    scoped.stores = this.stores
    return scoped
  }
  /** The login of one profile: `<client id>:<profile>` in the keyring. */
  forProfile(profile: string): TokenManager {
    const parent = this.options
    const scoped = new TokenManager({
      get clientId() {
        return parent.clientId
      },
      get account() {
        return `${parent.clientId}:${profile}`
      },
      keyring: parent.keyring,
      service: parent.service,
      ...(parent.configDir === undefined ? {} : { configDir: parent.configDir }),
      ...(parent.storage === undefined ? {} : { storage: parent.storage }),
      fetch: parent.fetch,
      now: parent.now,
      log: parent.log,
      signal: parent.signal,
    })
    scoped.refreshState = this.refreshState
    scoped.stores = this.stores
    return scoped
  }
  withSignal(signal?: AbortSignal, fetcher: typeof fetch = this.options.fetch): TokenManager {
    const parent = this.options
    // The account is built from the client id, so both are fixed together on first use.
    let login: Pick<TokenOptions, "clientId" | "account"> | undefined
    const pinned = () => (login ??= { clientId: parent.clientId, account: parent.account })
    const scoped = new TokenManager({
      get clientId() {
        return pinned().clientId
      },
      get account() {
        return pinned().account
      },
      keyring: parent.keyring,
      service: parent.service,
      ...(parent.configDir === undefined ? {} : { configDir: parent.configDir }),
      ...(parent.storage === undefined ? {} : { storage: parent.storage }),
      fetch: fetcher,
      now: parent.now,
      log: parent.log,
      signal: signal && parent.signal ? AbortSignal.any([signal, parent.signal]) : (signal ?? parent.signal),
    })
    scoped.refreshState = this.refreshState
    scoped.stores = this.stores
    return scoped
  }
  private accountOf(): string {
    return this.options.account ?? this.options.clientId
  }
  private read(account: string): string | null {
    if (this.stores) return this.stores.auto.read(account)?.secret ?? null
    try {
      return this.options.keyring.get(this.options.service, account)
    } catch {
      throw new CliError("configuration_error", "system keyring is unavailable")
    }
  }
  load(account = this.accountOf()): Tokens | null {
    const saved = this.read(account)
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
    } catch (error) {
      if (isCliError(error) && error.code === "configuration_error") throw error
      throw new CliError(
        "authentication_error",
        "saved login is invalid; run zm <profile> session start again, or sign in from WireCat Desktop (Tools → Zoom → Manage)",
      )
    }
  }
  /** `signIn` moves a login kept in the file back to the keyring; a refresh stays where the login is. */
  save(tokens: Tokens, account = this.accountOf(), { signIn = false } = {}): void {
    if (this.stores) {
      const value = JSON.stringify(tokens)
      if (this.options.storage !== "file") {
        this.stores.auto.write(account, value, { signIn })
        return
      }
      this.stores.file.write(account, value)
      if (signIn) this.forgetKeyringCopy(account)
      return
    }
    try {
      this.options.keyring.set(this.options.service, account, JSON.stringify(tokens))
    } catch {
      throw new CliError("configuration_error", "could not save login to the system keyring")
    }
  }
  /** After `--credential-storage file`: an older keyring copy must not outlive the file the owner chose. */
  private forgetKeyringCopy(account: string): void {
    try {
      this.stores?.keyring.remove(account)
    } catch {
      // No keyring on this computer: there is no copy to forget.
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
      this.save(tokens, account, { signIn: params.grant_type !== "refresh_token" })
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
    if (!saved)
      throw new CliError(
        "authentication_error",
        "run zm <profile> session start first, or sign in from WireCat Desktop (Tools → Zoom → Manage)",
      )
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
