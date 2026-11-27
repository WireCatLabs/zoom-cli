import type { KeyringStore, Logger } from "@wirecat/cli-base"
import { CliError, resolvePaths } from "@wirecat/cli-base"
import {
  credentialStorage,
  type LegacyAccount,
  type OAuthProvider,
  oauthAccount,
  type TokenCodec,
  type TokenSet,
  tokenKeeper,
  zoomTokenCodec,
} from "@wirecat/cli-core/oauth"
import { ZM } from "./identity.js"

export const REDIRECT = "https://wirecat.dev/zoom-callback"

/** Zoom replaces the refresh token on every refresh, so a run with moved folders must never refresh the owner's. */
export const ZOOM_CODEC: TokenCodec = { ...zoomTokenCodec, rotating: true }

/** A Public Client app: PKCE, no secret, and the relay page that forwards Zoom's redirect to the loopback port. */
export const zoomProvider = (clientId: string): OAuthProvider => ({
  id: "zoom",
  name: "Zoom",
  authorizeUrl: "https://zoom.us/oauth/authorize",
  tokenUrl: "https://zoom.us/oauth/token",
  client: { clientId },
  redirect: { kind: "relay", url: REDIRECT },
})

/** Before `oauth:zoom:<profile>`, a sign-in lived under a service per config folder, named by the client id. */
export const legacyAccountsOf = (
  service: string | undefined,
  clientId: string | undefined,
  profile: string,
): LegacyAccount[] => (service && clientId ? [{ service, account: `${clientId}:${profile}` }] : [])

export interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
}
export interface TokenOptions {
  clientId: string
  /** Set by `forProfile`: the sign-in is `oauth:zoom:<profile>` (WC-SECR-24). */
  profile?: string
  keyring: KeyringStore
  service: string
  /** The private file's folder (WC-SECR-4) and the refresh lock's; the default config folder when unset. */
  configDir?: string
  /** A run with moved folders (`isMovedZmRun`): it reads the owner's sign-in, but never replaces or deletes it. */
  isolated?: boolean
  legacyService?: string
  lockWaitMs?: number
  fetch: typeof fetch
  now?: () => number
  signal?: AbortSignal
  log?: Logger
}

const tokensOf = (set: TokenSet): Tokens => ({
  accessToken: set.accessToken ?? "",
  refreshToken: set.refreshToken,
  expiresAt: set.expiresAt ?? 0,
  scopes: set.scopes,
})

/** The API's view of a profile's sign-in, kept and refreshed by cli-core's token keeper in `session start`'s entry. */
export class TokenManager {
  constructor(readonly options: TokenOptions) {}
  forProfile(profile: string): TokenManager {
    const parent = this.options
    return new TokenManager({
      ...this.rest(),
      get clientId() {
        return parent.clientId
      },
      profile,
      fetch: parent.fetch,
      ...(parent.signal ? { signal: parent.signal } : {}),
    })
  }
  withSignal(signal?: AbortSignal, fetcher: typeof fetch = this.options.fetch): TokenManager {
    const parent = this.options
    // The old entry's account is built from the client id, so the client is fixed on first use.
    let clientId: string | undefined
    const joined = signal && parent.signal ? AbortSignal.any([signal, parent.signal]) : (signal ?? parent.signal)
    return new TokenManager({
      ...this.rest(),
      get clientId() {
        clientId ??= parent.clientId
        return clientId
      },
      ...(parent.profile === undefined ? {} : { profile: parent.profile }),
      fetch: fetcher,
      ...(joined ? { signal: joined } : {}),
    })
  }
  private rest(): Omit<TokenOptions, "clientId" | "profile" | "fetch" | "signal"> {
    const { keyring, service, configDir, isolated, legacyService, lockWaitMs, now, log } = this.options
    return {
      keyring,
      service,
      ...(configDir === undefined ? {} : { configDir }),
      ...(isolated === undefined ? {} : { isolated }),
      ...(legacyService === undefined ? {} : { legacyService }),
      ...(lockWaitMs === undefined ? {} : { lockWaitMs }),
      ...(now ? { now } : {}),
      ...(log ? { log } : {}),
    }
  }
  private profile(): string {
    const { profile } = this.options
    if (profile === undefined) throw new CliError("configuration_error", "a Zoom sign-in belongs to a profile")
    return profile
  }
  private configDir(): string {
    return this.options.configDir ?? resolvePaths({ appName: ZM.appName, prefix: ZM.envPrefix }).config
  }
  private storage() {
    const profile = this.profile()
    return credentialStorage({
      credentials: {
        service: this.options.service,
        configDir: this.configDir(),
        keyring: this.options.keyring,
        ...(this.options.isolated ? { isolated: true } : {}),
      },
      account: oauthAccount("zoom", profile),
      legacyAccounts: legacyAccountsOf(this.options.legacyService, this.options.clientId, profile),
      codec: ZOOM_CODEC,
    })
  }
  load(): Tokens | null {
    const saved = this.storage().read()
    return saved ? tokensOf(saved.tokens) : null
  }
  save(tokens: Tokens): void {
    this.storage().write({ tokens, client: { clientId: this.options.clientId } })
  }
  /** False when there was none. The old entry goes too, or the next read would copy it back. */
  remove(): boolean {
    const storage = this.storage()
    // A removal over an unreachable keyring only warns; reading first names it, or "nothing to end" would leave the
    // sign-in in the keyring.
    storage.read()
    return storage.remove().length > 0
  }
  async tokens(): Promise<Tokens> {
    const { clientId, fetch, now, signal, log, lockWaitMs } = this.options
    const keeper = tokenKeeper({
      provider: zoomProvider(clientId),
      storage: this.storage(),
      lockDir: this.configDir(),
      fetch,
      signInCommand: `zm ${this.profile()} session start`,
      ...(now ? { now } : {}),
      ...(signal ? { signal } : {}),
      ...(log ? { log } : {}),
      ...(lockWaitMs === undefined ? {} : { lockWaitMs }),
    })
    return tokensOf(await keeper.tokens())
  }
}
