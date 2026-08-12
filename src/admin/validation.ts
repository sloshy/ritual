/** Shared input-validation constants for admin API endpoints. */

/**
 * The declared body size (bytes) allowed on routes whose body is bounded by its
 * own shape — credentials, a config object, a list name. It is also what
 * `validateBodySize`/`readJsonObjectBody` apply when a route passes no budget of
 * its own, so a route that needs more has to say so.
 *
 * Note what this does and does not buy: the check reads `Content-Length` rather
 * than measuring, so it is a courtesy refusal for a well-behaved client, not a
 * defense — see {@link validateBodySize} for the ways past it.
 */
export const MAX_BODY_SIZE = 10 * 1024

/**
 * The budget for routes whose body has no small bound in its shape: a list save,
 * a changelog rewrite, a bulk move, an import's raw text, or a patch carrying
 * free-form prose (a deck description or primer).
 *
 * {@link MAX_BODY_SIZE} put an arbitrary ceiling of a few dozen changes on a
 * single save — re-pinning the printing of every card in a commander deck is one
 * ordinary edit that sends ~100 changes — and reported it only as "Request body
 * too large".
 *
 * Sized off the most expensive route rather than the cheapest. The three saves
 * do not send the same thing: a collection save sends only its changes (entries
 * are rebuilt server-side), while deck and wanted saves send the whole list
 * *plus* a change per edited card. At roughly 130 bytes per serialized entry and
 * 150 per change, 2 MiB covers a ~7,000-entry list under a full re-pin — beyond
 * any deck or wanted list, though a five-figure collection edited entry-by-entry
 * would need more.
 *
 * A route whose body scales with its own item limit should derive a cap from
 * that limit instead of borrowing this one — see `MAX_QUOTE_BODY_BYTES` in
 * `src/api/buylist.ts` and `MAX_PRICE_BODY_BYTES` in `src/api/card-prices.ts`.
 */
export const MAX_LIST_BODY_SIZE = 2 * 1024 * 1024

/** Maximum length for a username field. */
export const MAX_USERNAME_LENGTH = 64

/** Maximum length for a password field. */
export const MAX_PASSWORD_LENGTH = 128

/** Minimum length for a password field. */
export const MIN_PASSWORD_LENGTH = 8
