/** Bulk cache is considered stale if older than this (7 days). */
export const BULK_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Individual card prices are considered stale after this interval (24 hours). */
export const PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Trigger bulk refresh instead of individual fetches when this many cards are missing. */
export const BULK_FETCH_THRESHOLD = 100

/**
 * Default for the `cacheLockTimeoutSeconds` config key: how long cache
 * refreshes wait for another process's cache-write lock before failing.
 * Lives here (not ritual-config.ts) so browser code can import it — this
 * module must stay free of node-only imports.
 */
export const DEFAULT_CACHE_LOCK_TIMEOUT_SECONDS = 300
