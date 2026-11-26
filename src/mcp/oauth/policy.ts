/**
 * The embedded authorization server's fixed limits and lifetimes, in one place
 * so the docs, the tests and the code quote the same figures. None of these is
 * a config key: the feature is beta, and its numbers move with it.
 */

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** An access token's lifetime. */
export const ACCESS_TOKEN_TTL_MS = HOUR_MS

/** A refresh token's lifetime, restarted by every rotation (a sliding window). */
export const REFRESH_TOKEN_TTL_MS = 90 * DAY_MS

/**
 * How long the refresh token just rotated away may come back without revoking
 * its grant: a client retrying a refresh whose answer it lost, or two of its
 * requests refreshing at once. It is still refused (`invalid_grant`).
 */
export const REFRESH_GRACE_MS = MINUTE_MS

/** An authorization code's lifetime: one use, within this long of the consent. */
export const AUTHORIZATION_CODE_TTL_MS = MINUTE_MS

/** How long a rendered login + consent page stays submittable. */
export const PENDING_AUTHORIZATION_TTL_MS = 10 * MINUTE_MS

/**
 * The most consent pages held open at once. `GET /oauth/authorize` is
 * unauthenticated and each one holds memory, so past this the oldest page of
 * the address holding the most is dropped. One page is at most about 10 KB
 * (its longest parts are the client's `state`, up to {@link MAX_STATE_LENGTH},
 * and a registered redirect URI, up to {@link MAX_REDIRECT_URI_LENGTH}), so a
 * full table stays near 20 MB at worst and is typically about 2 MB.
 */
export const MAX_PENDING_AUTHORIZATIONS = 2000

/** Failed sign-ins one consent page takes before it is spent and must be reopened. */
export const MAX_FAILED_ATTEMPTS_PER_PAGE = 3

/** The most consent pages one client address may hold open; its oldest goes past this. */
export const MAX_PENDING_PER_ADDRESS = 10

/** Consent pages one client address may open in {@link AUTHORIZE_WINDOW_MINUTES}. */
export const MAX_AUTHORIZE_PAGES_PER_WINDOW = 30

/** The consent-page rate limit's window, in minutes. */
export const AUTHORIZE_WINDOW_MINUTES = 10

/** Password checks (bcrypt) running at once across all addresses; more wait their turn. */
export const MAX_CONCURRENT_SIGN_INS = 4

/** Sign-ins waiting for a check beyond those running; past this a sign-in is refused at once. */
export const MAX_QUEUED_SIGN_INS = 16

/** How long a refused-as-busy sign-in is told to wait (`Retry-After`), in seconds. */
export const BUSY_RETRY_AFTER_SECONDS = 5

/** The most registered clients kept. Registration is unauthenticated and writes state. */
export const MAX_CLIENTS = 100

/**
 * How many already-rotated refresh tokens a grant remembers, so that presenting
 * one (a stolen token used after its owner refreshed) revokes the grant. An
 * older one than this is merely unknown.
 */
export const MAX_ROTATED_REFRESH_HASHES = 20

/** Registrations accepted per client address in {@link REGISTRATION_WINDOW_MINUTES}. */
export const MAX_REGISTRATIONS_PER_WINDOW = 20

/** The registration rate limit's window, in minutes (the unit `RateLimiter` takes). */
export const REGISTRATION_WINDOW_MINUTES = 60

/** The body budget of every OAuth endpoint: registration JSON and the two forms. */
export const MAX_OAUTH_BODY_BYTES = 16 * 1024

/** The most redirect URIs one client may register. */
export const MAX_REDIRECT_URIS = 10

/** The longest redirect URI accepted. */
export const MAX_REDIRECT_URI_LENGTH = 2000

/** The longest `client_name` accepted. */
export const MAX_CLIENT_NAME_LENGTH = 200

/** The longest `state` passed through to the client. */
export const MAX_STATE_LENGTH = 2048
