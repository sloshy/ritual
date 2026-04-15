/** Bulk cache is considered stale if older than this (7 days). */
export const BULK_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Individual card prices are considered stale after this interval (24 hours). */
export const PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Trigger bulk refresh instead of individual fetches when this many cards are missing. */
export const BULK_FETCH_THRESHOLD = 100
