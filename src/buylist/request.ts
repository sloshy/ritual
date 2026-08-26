/**
 * The one rule for turning a displayed printing into a buylist quote request,
 * shared by every side that quotes: the server-side bake (`build-site` and the
 * live server), the client store's per-card lookup, and the admin's live quote
 * requests.
 *
 * It lives here, in the browser-safe buylist vocabulary, because both sides have
 * to produce the *identical* {@link quoteKey}. A near-miss between them does not
 * yield a blank cell — it yields a wrong price, or a baked quote the page can
 * never find. One function, no restatements.
 */

import { displayFinish, type Finish } from '../card/finish-condition'
import { displayLanguage, scryfallCardLanguage, type CardLanguage } from '../card/card-language'
import type { ScryfallCard } from '../scryfall/types'
import type { BuylistQuoteRequest } from './types'

/**
 * Whether a displayed printing may be quoted at all.
 *
 * Both halves of the language gate are checked, and both are load-bearing:
 *
 * - **The entry's own token.** A buyer's feed is English-only and quotes are
 *   keyed by `set:cn:finish`, which an alternate-language copy *shares* with its
 *   English twin. Under the default `en` cache no `@lang` object is baked, so a
 *   `[ja]` line resolves to the English card object and would otherwise read the
 *   key an English sibling in the same list registered — displaying the English
 *   offer on a Japanese card.
 * - **The resolved card object.** A list whose language objects *are* cached
 *   resolves a foreign printing directly, and it must not be quoted either.
 */
export function isQuotableCard(
  card: ScryfallCard | null,
  language?: CardLanguage,
): card is ScryfallCard {
  if (!card) return false
  return displayLanguage(language) === 'en' && scryfallCardLanguage(card) === 'en'
}

/**
 * The quote request for a displayed printing, or null when it has no resolved
 * card or is not quotable (see {@link isQuotableCard}).
 *
 * `finish` is the entry's own `[foil]` token, resolved through `displayFinish`
 * so a foil-only printing is quoted as foil rather than as a nonfoil that does
 * not exist. `language` is forwarded even though the gate above already refuses
 * anything non-English, so the matcher's own English-only check sees the entry's
 * token rather than trusting this caller.
 */
export function buylistRequestFor(
  card: ScryfallCard | null,
  finish: Finish | undefined,
  language?: CardLanguage,
): BuylistQuoteRequest | null {
  if (!isQuotableCard(card, language)) return null
  return {
    // Set codes are lowercase internally, per the project-wide rule.
    set: card.set.toLowerCase(),
    collectorNumber: card.collector_number,
    finish: displayFinish(card, finish),
    scryfallId: card.id,
    ...(language !== undefined ? { language } : {}),
  }
}
