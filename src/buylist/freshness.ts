/**
 * How long a downloaded buyer feed counts as fresh — the one definition, shared
 * by the server (which decides whether to re-download) and both site bundles
 * (which decide whether to warn that a quote is old).
 *
 * It lives here rather than beside the Card Kingdom cache because the client
 * needs it too: baked quotes carry only `feedRetrievedAt`, so staleness is
 * derived in the browser, and `src/cardkingdom/cache.ts` imports `node:path`.
 * Two copies of the threshold would let the CLI and the site disagree about the
 * same feed.
 */

/** Buyer feeds regenerate daily, so anything younger than a day is fresh. */
export const BUYLIST_FEED_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Whether a feed downloaded at `retrievedAt` is past {@link BUYLIST_FEED_MAX_AGE_MS}. */
export function buylistFeedIsStale(retrievedAt: number, now: number): boolean {
  return now - retrievedAt > BUYLIST_FEED_MAX_AGE_MS
}
