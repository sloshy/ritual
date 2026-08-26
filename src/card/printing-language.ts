/**
 * The one rule for what language an entry is stamped with when a printing is
 * chosen for it: prefer the user's primary language wherever possible,
 * defaulting to English, else the only available printing.
 *
 * Shared by every surface that stamps a language from availability — the CLI
 * printing picker and its non-interactive add path, CSV imports without a
 * language column, the editor's card search, and the trade printing picker —
 * so they can never disagree about what "prefer the default language" means.
 * (Sync pulls are not a caller: Archidekt remote records always carry a
 * language id, degraded to English when unknown.)
 */

import { displayLanguage, type CardLanguage } from './card-language'
import { printingLanguages } from './card-printing'
import type { ScryfallCard } from '../scryfall/types'

/**
 * The outcome of {@link resolvePrintingLanguage}: the language the entry must
 * record, plus whether the preferred language was honored. `honoredPreferred`
 * is what the "only available in …" notice surfaces branch on — a false value
 * means the entry is being stamped with a language other than the preferred
 * one, which the user should see.
 */
export type ResolvedPrintingLanguage = {
  language: CardLanguage
  honoredPreferred: boolean
}

/**
 * Choose the language an entry for `set:collectorNumber` should carry, given
 * the languages the local cache holds for the printing and the `preferred`
 * language (normally the configured `defaultLanguage`).
 *
 * - When the printing is available in `preferred`, that wins.
 * - When availability is unknowable from `printings` — the list holds no object
 *   for the printing at all (an uncached printing, or an `en`-only
 *   `default_cards` cache asked about a foreign default is indistinguishable
 *   from that) — `preferred` also wins: the rule is to prefer the primary
 *   language wherever the data cannot rule it out.
 * - Otherwise English when the printing exists in English.
 * - Otherwise the only available language — and when several non-English,
 *   non-preferred languages exist, the first in canonical
 *   {@link printingLanguages} order.
 *
 * Callers should fold the result through `storedLanguage` (en is written
 * bare): a returned `en` means *no token*, not an explicit `[en]`.
 */
export function resolvePrintingLanguage(
  printings: ScryfallCard[] | undefined,
  set: string | undefined,
  collectorNumber: string | undefined,
  preferred: CardLanguage,
): ResolvedPrintingLanguage {
  const resolved = displayLanguage(preferred)
  const available = printingLanguages(printings, set, collectorNumber)
  if (available.length === 0 || available.includes(resolved)) {
    return { language: resolved, honoredPreferred: true }
  }
  if (available.includes('en')) return { language: 'en', honoredPreferred: false }
  return { language: available[0]!, honoredPreferred: false }
}
