import { createHash } from "node:crypto"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { KeyringStore, Logger } from "@wirecat/cli-base"
import { CliError, Credentials, isCliError } from "@wirecat/cli-base"
import { acquireLock } from "@wirecat/cli-core/files"
import { oauthAccount } from "@wirecat/cli-core/oauth"
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
  /** A run with moved folders (`isMovedZmRun`): it reads the owner's sign-in, but never replaces or deletes it. */
  isolated?: boolean
  /** Where an older version kept this login; read once when the account is empty, then copied to it. */
  legacyService?: string
  legacyAccount?: string
  /** How long a refresh waits for another process's refresh of the same login. */
  lockWaitMs?: number
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
type Stores = { auto: Credentials; file: Credentials; keyring: Credentials; legacy?: Credentials }

const storesOf = ({ configDir, service, keyring, isolated, legacyService }: TokenOptions): Stores | undefined => {
  if (configDir === undefined) return undefined
  const common = { configDir, keyring, ...(isolated ? { isolated } : {}) }
  return {
    auto: new Credentials({ ...common, service }),
    file: new Credentials({ ...common, service, storage: "file" }),
    keyring: new Credentials({ ...common, service, storage: "keyring" }),
    ...(legacyService === undefined ? {} : { legacy: new Credentials({ ...common, service: legacyService }) }),
  }
}
const shared = (options: TokenOptions) => ({
  keyring: options.keyring,
  service: options.service,
  ...(options.configDir === undefined ? {} : { configDir: options.configDir }),
  ...(options.storage === undefined ? {} : { storage: options.storage }),
  ...(options.isolated === undefined ? {} : { isolated: options.isolated }),
  ...(options.legacyService === undefined ? {} : { legacyService: options.legacyService }),
  ...(options.lockWaitMs === undefined ? {} : { lockWaitMs: options.lockWaitMs }),
  now: options.now,
  log: options.log,
})
const notSignedIn = () =>
  new CliError(
    "authentication_error",
    "run zm <profile> session start first, or sign in from WireCat Desktop (Tools → Zoom → Manage)",
  )

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
  /** The login of one profile: `oauth:zoom:<profile>` in the keyring (WC-SECR-24). */
  forProfile(profile: string): TokenManager {
    const parent = this.options
    const scoped = new TokenManager({
      ...shared(parent),
      get clientId() {
        return parent.clientId
      },
      account: oauthAccount("zoom", profile),
      get legacyAccount() {
        return `${parent.clientId}:${profile}`
      },
      fetch: parent.fetch,
      signal: parent.signal,
    })
    scoped.refreshState = this.refreshState
    scoped.stores = this.stores
    return scoped
  }
  withSignal(signal?: AbortSignal, fetcher: typeof fetch = this.options.fetch): TokenManager {
    const parent = this.options
    // The old account name is built from the client id, so they are fixed together on first use.
    let login: Pick<TokenOptions, "clientId" | "account" | "legacyAccount"> | undefined
    const pinned = () =>
      (login ??= { clientId: parent.clientId, account: parent.account, legacyAccount: parent.legacyAccount })
    const scoped = new TokenManager({
      ...shared(parent),
      get clientId() {
        return pinned().clientId
      },
      get account() {
        return pinned().account
      },
      get legacyAccount() {
        return pinned().legacyAccount
      },
      fetch: fetcher,
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
    if (this.stores) return this.stores.auto.read(account)?.secret ?? this.migrated(account)
    try {
      return this.options.keyring.get(this.options.service, account)
    } catch {
      throw new CliError("configuration_error", "system keyring is unavailable")
    }
  }
  /** The login under the name an older version used, copied to the new one; a moved run only reads it. */
  private migrated(account: string): string | null {
    const legacy = this.legacyOf(account)
    const secret = legacy && this.stores?.legacy?.read(legacy)?.secret
    if (!secret) return null
    if (!this.options.isolated)
      try {
        this.stores?.auto.write(account, secret)
      } catch {
        // The next run tries again; this one can still use the login it read.
      }
    return secret
  }
  private legacyOf(account: string): string | undefined {
    return account === this.accountOf() ? this.options.legacyAccount : undefined
  }
  /**
   * Deletes this login from the keyring and from the private file; false when there was none. The old entry goes
   * too, or the next run would copy it back; a moved run leaves the owner's alone.
   */
  remove(account = this.accountOf()): boolean {
    if (this.stores) {
      const legacy = this.legacyOf(account)
      const old = legacy && !this.options.isolated ? (this.stores.legacy?.remove(legacy) ?? []) : []
      return this.stores.auto.remove(account).length + old.length > 0
    }
    try {
      return this.options.keyring.delete(this.options.service, account)
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
    if (!saved) throw notSignedIn()
    const fresh = (tokens: Tokens) => tokens.expiresAt > (this.options.now?.() ?? Date.now()) + 30000
    if (fresh(saved)) return saved
    let refreshing = this.refreshState.get(account)
    if (!refreshing) {
      refreshing = this.locked(account, async () => {
        const current = this.load(account)
        if (!current) throw notSignedIn()
        // Another process refreshed while this one waited: Zoom has already replaced the refresh token it read.
        if (current.refreshToken !== saved.refreshToken || fresh(current)) return current
        return this.exchange(
          { grant_type: "refresh_token", refresh_token: current.refreshToken },
          current,
          clientId,
          account,
        )
      }).finally(() => {
        this.refreshState.delete(account)
      })
      this.refreshState.set(account, refreshing)
    }
    const refreshed = await refreshing
    checkCancelled(this.options.signal)
    return refreshed
  }
  /** WC-SECR-22: one refresh of a login at a time across processes, under the lock cli-core's token keeper uses. */
  private async locked<T>(account: string, work: () => Promise<T>): Promise<T> {
    const { configDir, service, signal } = this.options
    if (configDir === undefined) return work()
    const key = createHash("sha256").update(`${service}\u0000${account}`).digest("hex").slice(0, 16)
    const path = join(configDir, `oauth-${key}.lock`)
    const started = performance.now()
    for (;;) {
      checkCancelled(signal)
      let lock: Awaited<ReturnType<typeof acquireLock>>
      try {
        lock = await acquireLock(path, signal ? { signal } : {})
      } catch (error) {
        if (!isCliError(error) || error.details.reason !== "file.locked") throw error
        if (performance.now() - started > (this.options.lockWaitMs ?? 45000))
          throw new CliError("provider_unavailable", "another zm process is refreshing this Zoom sign-in; retry", {
            retryable: true,
          })
        await delay(50, undefined, signal ? { signal } : {}).catch(() => checkCancelled(signal))
        continue
      }
      try {
        return await work()
      } finally {
        await lock.release().catch(() => {})
      }
    }
  }
}
