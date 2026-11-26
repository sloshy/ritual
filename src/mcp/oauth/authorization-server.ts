import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'
import { globalTotpBudget } from '../../admin/login-attempt'
import { RateLimiter } from '../../admin/rate-limit'
import { apiText } from '../../api/result'
import {
  createFingerprintReader,
  type FingerprintSource,
} from '../../auth/mcp-oauth/credential-fingerprint'
import type { OAuthClient, OAuthState } from '../../auth/mcp-oauth/state'
import type { OAuthStore } from '../../auth/mcp-oauth/store'
import { t } from '../../i18n/t'
import type { McpPublicUrl } from '../public-url'
import type { AuthorizationRequest } from './authorization'
import {
  dropDeadGrants,
  indexAccessTokens,
  issueGrant,
  revokeAllGrants,
  revokeGrant,
  rotateRefreshToken,
  type AccessTokenRecord,
  type GrantValidity,
  type IssuedTokens,
  type RefreshOutcome,
} from './grants'
import { oauthEndpoints, type OAuthEndpoints } from './metadata'
import { pageToEvict } from './pending-eviction'
import { verifyS256 } from './pkce'
import {
  AUTHORIZATION_CODE_TTL_MS,
  MAX_CONCURRENT_SIGN_INS,
  MAX_PENDING_AUTHORIZATIONS,
  MAX_PENDING_PER_ADDRESS,
  MAX_QUEUED_SIGN_INS,
  PENDING_AUTHORIZATION_TTL_MS,
  REFRESH_GRACE_MS,
} from './policy'
import { admitClient, type ClientRegistration } from './registration'
import {
  cryptoRandom,
  hashSecret,
  newSecret,
  systemClock,
  type Clock,
  type RandomSource,
} from './secrets'
import { SignInGate } from './sign-in-gate'

/** A rendered consent page waiting for its form: the validated request and its CSRF token. */
export type PendingAuthorization = {
  requestId: string
  csrfToken: string
  /** The CSRF cookie of the browser the page was shown in. */
  browserCookie: string
  /** The rate-limit key of the address that opened it. */
  addressKey: string
  request: AuthorizationRequest
  expiresAt: number
  /** Failed sign-ins on this page so far; it is spent at the per-page limit. */
  failures: number
}

/** An approved request, as an authorization code carries it. */
export type ApprovedRequest = AuthorizationRequest & {
  /** The admin credential fingerprint the owner signed in with. */
  credentialFingerprint: string
}

/** An authorization code's contents, held in memory only. */
type AuthorizationCode = {
  request: ApprovedRequest
  expiresAt: number
  /** Set once presented: a second presentation is a replay. */
  redeemed: boolean
  /** Set once a second presentation came: the code can never be used again. */
  replayed: boolean
  /** The grant the code is being exchanged for, minted before the write is queued. */
  grantId?: string
}

/**
 * A refresh answered in the last {@link REFRESH_GRACE_MS}, kept in memory
 * only (never on disk) so that the same client re-presenting the token it just
 * rotated away gets the same answer again instead of an error.
 */
type RecentRefresh = {
  grantId: string
  tokens: IssuedTokens
  expiresAt: number
}

/** A token request for the `authorization_code` grant. */
export type CodeExchange = {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
}

/**
 * The outcome of a code exchange: tokens, or `invalid` for every failure alike
 * (unknown, expired, replayed, another client's, another redirect URI, a wrong
 * verifier, a client gone meanwhile, a credential change since the approval),
 * which the token endpoint answers with one `invalid_grant`.
 */
export type CodeOutcome = { kind: 'issued'; tokens: IssuedTokens } | { kind: 'invalid' }

/** A refresh request as the token endpoint receives it. */
export type RefreshTokenRequest = {
  refreshToken: string
  clientId: string
}

/** How an {@link OAuthAuthorizationServer} is built. */
export type OAuthServerOptions = {
  store: OAuthStore
  publicUrl: McpPublicUrl
  /** The clock; the real one by default. Tests move time forward with it. */
  clock?: Clock
  /** The random source; the cryptographic one by default. */
  random?: RandomSource
  /** The current admin credential fingerprint; `admin-auth.json`'s by default. */
  fingerprint?: FingerprintSource
  /**
   * The budget of wrong authenticator codes; by default the process's own,
   * which the admin login shares. Tests give one on their own clock.
   */
  totpBudget?: RateLimiter
  /** The most consent pages held at once; {@link MAX_PENDING_AUTHORIZATIONS} by default. Tests shrink it. */
  maxPending?: number
  /** The most one address holds; {@link MAX_PENDING_PER_ADDRESS} by default. */
  maxPendingPerAddress?: number
}

/** The {@link OAuthServerOptions} that only tests set: every one but the store and public URL. */
export type OAuthServerSeams = Omit<OAuthServerOptions, 'store' | 'publicUrl'>

/**
 * The embedded, single-user OAuth 2.1 authorization server: the registry,
 * the consent flow's short-lived state, and the token rules, over one
 * {@link OAuthStore}. HTTP lives in the route modules; this class knows
 * nothing about requests. It is also the MCP endpoint's
 * {@link OAuthTokenVerifier}.
 *
 * Every grant and code is tied to the admin credential fingerprint it was
 * approved under, and every check compares it with the current one: a
 * password or TOTP change kills all of them at once, from any process.
 *
 * Authorization codes, pending consent pages and recent refresh answers live
 * in memory only: a restart in the middle of a sign-in simply makes the user
 * start it again.
 */
export class OAuthAuthorizationServer implements OAuthTokenVerifier {
  readonly endpoints: OAuthEndpoints
  readonly publicUrl: McpPublicUrl
  /** Registrations per client address; see `policy.ts`. */
  readonly registrationLimiter: RateLimiter
  /** Consent pages opened per client address. */
  readonly authorizePageLimiter: RateLimiter
  /** Failed consent sign-ins per client address: this server's own, not the admin login's. */
  readonly signInLimiter: RateLimiter
  /** Wrong authenticator codes across every address, shared with the admin login by default. */
  readonly totpBudget: RateLimiter
  /** Serializes password checks per address, caps them overall, bounds the queue. */
  readonly signInGate = new SignInGate(MAX_CONCURRENT_SIGN_INS, MAX_QUEUED_SIGN_INS)
  private readonly store: OAuthStore
  private readonly clock: Clock
  private readonly random: RandomSource
  private readonly fingerprint: FingerprintSource
  private readonly maxPending: number
  private readonly maxPendingPerAddress: number
  private readonly codes = new Map<string, AuthorizationCode>()
  private readonly pending = new Map<string, PendingAuthorization>()
  private readonly recentRefreshes = new Map<string, RecentRefresh>()
  private indexedState: Readonly<OAuthState> | undefined
  private accessIndex = new Map<string, AccessTokenRecord>()

  constructor(options: OAuthServerOptions) {
    this.store = options.store
    this.publicUrl = options.publicUrl
    this.endpoints = oauthEndpoints(options.publicUrl)
    this.clock = options.clock ?? systemClock
    this.random = options.random ?? cryptoRandom
    this.fingerprint = options.fingerprint ?? createFingerprintReader()
    const limiterClock = (): number => this.now()
    this.registrationLimiter = new RateLimiter(limiterClock)
    this.authorizePageLimiter = new RateLimiter(limiterClock)
    this.signInLimiter = new RateLimiter(limiterClock)
    this.totpBudget = options.totpBudget ?? globalTotpBudget
    this.maxPending = options.maxPending ?? MAX_PENDING_AUTHORIZATIONS
    this.maxPendingPerAddress = options.maxPendingPerAddress ?? MAX_PENDING_PER_ADDRESS
    this.store.protectClients(() => this.clientsInUse())
  }

  /**
   * Drop the grants that can never be used again — bound to another MCP URL
   * (the public URL changed) or approved under other admin credentials. Run
   * once before serving; every later change does the same.
   */
  async start(): Promise<void> {
    await this.update(() => undefined)
  }

  /** The current time, from the injected clock, in whole milliseconds. */
  now(): number {
    return Math.floor(this.clock())
  }

  /** A fresh secret from the injected random source. */
  secret(): string {
    return newSecret(this.random)
  }

  /** The admin credential fingerprint now; `undefined` (refuse everything) without an account. */
  currentFingerprint(): Promise<string | undefined> {
    return this.fingerprint()
  }

  /** A registered client by id, as the state file holds it now. */
  async findClient(clientId: string): Promise<Readonly<OAuthClient> | undefined> {
    return (await this.clients()).find((client) => client.clientId === clientId)
  }

  /** The registered clients, as the state file holds them now. */
  async clients(): Promise<readonly Readonly<OAuthClient>[]> {
    return (await this.store.read()).clients
  }

  /**
   * Register a client; `undefined` when the registry is full of clients that
   * hold grants or have an authorization code outstanding.
   */
  register(registration: ClientRegistration): Promise<OAuthClient | undefined> {
    const now = this.now()
    // Asked inside the change, which a queued or retried update runs later:
    // a code issued meanwhile must protect its client from eviction.
    return this.update((draft) =>
      admitClient(draft, now, this.random, registration, this.clientsInUse()),
    )
  }

  /**
   * Hold a validated request for its consent page. One address keeps at most
   * {@link MAX_PENDING_PER_ADDRESS} pages (its own oldest goes first); when
   * the whole table holds {@link MAX_PENDING_AUTHORIZATIONS}, the oldest page
   * of the address holding the most goes ({@link pageToEvict}), so a flood
   * from many addresses pushes out its own pages before anyone else's and a
   * new page is never refused. An evicted page's form answers as expired.
   */
  beginAuthorization(
    request: AuthorizationRequest,
    browserCookie: string,
    address: string,
  ): PendingAuthorization {
    this.prunePending()
    const own = [...this.pending.values()].filter((entry) => entry.addressKey === address)
    for (const entry of own.slice(0, Math.max(0, own.length - this.maxPendingPerAddress + 1))) {
      this.pending.delete(entry.requestId)
    }
    while (this.pending.size >= this.maxPending) {
      const evicted = pageToEvict(this.pending.values())
      if (evicted === undefined) break
      this.pending.delete(evicted)
    }
    const pending: PendingAuthorization = {
      requestId: this.secret(),
      csrfToken: this.secret(),
      browserCookie,
      addressKey: address,
      request,
      expiresAt: this.now() + PENDING_AUTHORIZATION_TTL_MS,
      failures: 0,
    }
    this.pending.set(pending.requestId, pending)
    return pending
  }

  /** A pending consent page that has not expired. */
  findPending(requestId: string): PendingAuthorization | undefined {
    this.prunePending()
    return this.pending.get(requestId)
  }

  /** Close a pending consent page (answered either way, or spent). */
  endPending(requestId: string): void {
    this.pending.delete(requestId)
  }

  /** Issue a single-use authorization code for a request the owner approved. */
  issueCode(request: ApprovedRequest): string {
    this.pruneCodes()
    const code = this.secret()
    this.codes.set(hashSecret(code), {
      request,
      expiresAt: this.now() + AUTHORIZATION_CODE_TTL_MS,
      redeemed: false,
      replayed: false,
    })
    return code
  }

  /**
   * Exchange an authorization code. The code is spent by its first
   * presentation, whatever its outcome; a second one revokes the grant the
   * first created (RFC 6749 §4.1.2), whichever finishes first: a replay that
   * comes after the grant was written revokes it; one that comes earlier is
   * seen by the first exchange, which then revokes its own grant.
   * A failed write un-spends the code so the client can retry — unless a
   * replay has meanwhile shown that someone else holds it.
   */
  async exchangeCode(exchange: CodeExchange): Promise<CodeOutcome> {
    this.pruneCodes()
    const hash = hashSecret(exchange.code)
    const entry = this.codes.get(hash)
    if (entry === undefined || entry.expiresAt <= this.now()) return { kind: 'invalid' }
    if (entry.redeemed) {
      entry.replayed = true
      if (entry.grantId !== undefined) await this.revokeGrant(entry.grantId)
      return { kind: 'invalid' }
    }
    // Spent and given its grant id in one synchronous step, before any await:
    // a replay arriving at any later point finds the id to revoke.
    entry.redeemed = true
    const grantId = this.secret()
    entry.grantId = grantId
    const { request } = entry
    if (
      request.clientId !== exchange.clientId ||
      request.redirectUri !== exchange.redirectUri ||
      !verifyS256(exchange.codeVerifier, request.codeChallenge) ||
      request.credentialFingerprint !== (await this.currentFingerprint())
    ) {
      return { kind: 'invalid' }
    }
    const now = this.now()
    try {
      const outcome = await this.update((draft) =>
        issueGrant(draft, { now, random: this.random }, { ...request, grantId }),
      )
      // A replay that came while this was being written may have found no
      // grant to revoke yet: this exchange revokes its own grant instead.
      if (entry.replayed) {
        await this.revokeGrant(grantId)
        return { kind: 'invalid' }
      }
      return outcome.kind === 'issued' ? outcome : { kind: 'invalid' }
    } catch (error) {
      if (entry.replayed) {
        this.codes.delete(hash)
      } else {
        entry.redeemed = false
        delete entry.grantId
      }
      throw error
    }
  }

  /**
   * Rotate a refresh token for this server's MCP URL and the current admin
   * credentials; see `rotateRefreshToken`. The same client re-presenting the
   * token it rotated away within {@link REFRESH_GRACE_MS} gets the answer it
   * got then, while that grant is still alive.
   */
  async refresh(request: RefreshTokenRequest): Promise<RefreshOutcome> {
    const fingerprint = await this.currentFingerprint()
    if (fingerprint === undefined) return { kind: 'invalid' }
    const cacheKey = `${hashSecret(request.refreshToken)}\0${request.clientId}`
    const cached = await this.recentRefresh(cacheKey, fingerprint)
    if (cached !== undefined) return { kind: 'issued', tokens: cached }
    const now = this.now()
    const outcome = await this.update(
      (draft) =>
        rotateRefreshToken(
          draft,
          { now, random: this.random },
          { ...request, ...this.validity(fingerprint) },
        ),
      fingerprint,
    )
    if (outcome.kind === 'issued') {
      this.recentRefreshes.set(cacheKey, {
        grantId: outcome.tokens.grantId,
        tokens: outcome.tokens,
        expiresAt: now + REFRESH_GRACE_MS,
      })
      return outcome
    }
    if (outcome.kind === 'retried') {
      // Two refreshes at once: the other one may have just cached its answer.
      const raced = await this.recentRefresh(cacheKey, fingerprint)
      if (raced !== undefined) return { kind: 'issued', tokens: raced }
    }
    if (outcome.kind === 'replayed') {
      const clientName = this.store.state.clients.find(
        (client) => client.clientId === outcome.clientId,
      )?.clientName
      console.error(t('cli.mcp.oauth.refreshReplayed', { client: clientName ?? outcome.clientId }))
    }
    return outcome
  }

  /** Revoke one grant and every token issued under it. Whether it existed. */
  revokeGrant(grantId: string): Promise<boolean> {
    return this.update((draft) => revokeGrant(draft, grantId))
  }

  /** Revoke every grant. How many there were. */
  revokeAllGrants(): Promise<number> {
    return this.update((draft) => revokeAllGrants(draft))
  }

  /**
   * Verify an access token for the MCP endpoint ({@link OAuthTokenVerifier}).
   * Unknown, revoked, expired and dead tokens (approved under other admin
   * credentials) are all `invalid_token`, and so is every token while the
   * state file or the credentials are unusable; the SDK's bearer helper then
   * also checks the audience against the MCP URL.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const invalid = (): OAuthError =>
      new OAuthError(OAuthErrorCode.InvalidToken, apiText('cli.mcp.oauth.error.invalidToken'))
    const fingerprint = await this.currentFingerprint()
    if (fingerprint === undefined) throw invalid()
    let state: Readonly<OAuthState>
    try {
      state = await this.store.read()
    } catch {
      throw invalid()
    }
    const record = this.accessTokens(state).get(hashSecret(token))
    if (
      record === undefined ||
      record.expiresAt <= this.now() ||
      record.credentialFingerprint !== fingerprint
    ) {
      throw invalid()
    }
    return {
      token,
      clientId: record.clientId,
      scopes: [...record.scopes],
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: new URL(record.resource),
    }
  }

  /** What a grant must match now, given the current fingerprint. */
  private validity(credentialFingerprint: string): GrantValidity {
    return { resource: this.endpoints.resource, credentialFingerprint }
  }

  /**
   * Every change to the stored state goes through here: it also drops the
   * grants that are dead under the current fingerprint (when there is one), so
   * a credential change is reflected on disk at the server's next write.
   */
  private async update<T>(change: (draft: OAuthState) => T, knownFingerprint?: string): Promise<T> {
    const fingerprint = knownFingerprint ?? (await this.currentFingerprint())
    return this.store.update(this.now(), (draft) => {
      const result = change(draft)
      if (fingerprint !== undefined) dropDeadGrants(draft, this.validity(fingerprint))
      return result
    })
  }

  /** The cached answer to a refresh retried within the window, while its grant lives. */
  private async recentRefresh(
    cacheKey: string,
    fingerprint: string,
  ): Promise<IssuedTokens | undefined> {
    const now = this.now()
    for (const [key, entry] of this.recentRefreshes) {
      if (entry.expiresAt <= now) this.recentRefreshes.delete(key)
    }
    const entry = this.recentRefreshes.get(cacheKey)
    if (entry === undefined) return undefined
    const grant = (await this.store.read()).grants.find((g) => g.grantId === entry.grantId)
    if (grant === undefined || grant.credentialFingerprint !== fingerprint) {
      this.recentRefreshes.delete(cacheKey)
      return undefined
    }
    return entry.tokens
  }

  /** The access-token index, rebuilt whenever the store's state changed. */
  private accessTokens(state: Readonly<OAuthState>): Map<string, AccessTokenRecord> {
    if (state !== this.indexedState) {
      this.accessIndex = indexAccessTokens(state)
      this.indexedState = state
    }
    return this.accessIndex
  }

  /**
   * The clients with an authorization code outstanding: never pruned or
   * evicted. Only a code counts, since getting one takes the admin password;
   * an open consent page is anonymous and protects nothing.
   */
  private clientsInUse(): ReadonlySet<string> {
    const now = this.now()
    const ids = new Set<string>()
    for (const code of this.codes.values()) {
      if (code.expiresAt > now && !code.replayed) ids.add(code.request.clientId)
    }
    return ids
  }

  private prunePending(): void {
    const now = this.now()
    for (const [id, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(id)
    }
  }

  private pruneCodes(): void {
    const now = this.now()
    for (const [hash, code] of this.codes) {
      if (code.expiresAt <= now) this.codes.delete(hash)
    }
  }
}
