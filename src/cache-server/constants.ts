export const DAY_REFRESH_MS = 24 * 60 * 60 * 1000
export const WEEKLY_REFRESH_MS = 7 * DAY_REFRESH_MS
export const MONTHLY_REFRESH_MS = 30 * DAY_REFRESH_MS
export const PRICE_REFRESH_STAGGER_MS = 200
export const CACHE_SERVER_LOG_PREFIX = '[cache-server]'

/**
 * The body budget of `PUT /cache/<section>/<key>`: one entry — one card name's
 * printings (every language's, under an all-languages cache) or one price.
 */
export const MAX_ENTRY_BODY_SIZE = 16 * 1024 * 1024

/** The body budget of `POST /cache/prices/stream`: the cache keys to resolve. */
export const MAX_STREAM_BODY_SIZE = 4 * 1024 * 1024

/**
 * The body budget of `PUT /cache/<section>/bulk`. A client's full card refresh
 * sends the whole card cache in one request (about 450 MB for the English-only
 * data), so this budget is sized for that rather than for an ordinary request.
 */
export const MAX_BULK_BODY_SIZE = 1024 * 1024 * 1024

/**
 * The hard ceiling the cache server sets on every request body
 * (`maxRequestBodySize`; without one, Bun's 128 MB default would refuse a full
 * card refresh). The largest route budget plus headroom, so a body just past a
 * route's budget meets that route's JSON refusal rather than the runtime's
 * empty 413.
 */
export const MAX_CACHE_SERVER_REQUEST_BODY_SIZE = MAX_BULK_BODY_SIZE + 64 * 1024
