import type { Finish, ScryfallCard } from './types'
import { printingFinishes } from './finish-condition'
import {
  displayLanguage,
  scryfallCardLanguage,
  sortLanguages,
  type CardLanguage,
} from './card-language'
import { cardPrintingKey } from './printing-key'

/** One printing at one of the finishes it is published in. */
export type PrintingFinish = {
  card: ScryfallCard
  finish: Finish
}

/**
 * Every printing in a list, at every finish it publishes — the enumeration a
 * buyer's quotes are gathered over.
 *
 * One function because the two halves of that gathering must agree exactly: a
 * static build bakes this set into each list detail, and a live backend quotes
 * whatever the build did not carry. If one side ever enumerated fewer pairs than
 * the other, a static site would render "no price" precisely where a served one
 * renders a figure, and nothing would fail loudly.
 */
export function printingFinishPairs(cards: readonly ScryfallCard[]): PrintingFinish[] {
  return cards.flatMap((card) => printingFinishes(card).map((finish) => ({ card, finish })))
}

/** The two fields that together pin a printing; either may be absent. */
export type PrintingFields = { set?: string; collectorNumber?: string }
type SpecificPrinting = { set: string; collectorNumber: string }

/**
 * Resolves a card name to every cached printing of it. Satisfied in production
 * by `getCardPrintings`; tests pass a map-backed stub. Declared here rather than
 * beside either consumer so the collection sync and the export engine share one
 * seam instead of two structurally identical ones.
 */
export type CardPrintingsLookup = (name: string) => Promise<ScryfallCard[]>

/**
 * How much a printings list can be trusted to be the whole story — the
 * difference between "these are all the printings that exist" and "this is what
 * happened to be at hand".
 *
 * - `complete`: the list came from a bulk-downloaded card cache, so it holds
 *   every printing of the card. Only this source may be read as exhaustive
 *   (e.g. "length === 1 means a single-printing card").
 * - `partial`: one or more printings, with no guarantee there aren't others —
 *   a single-card `/cards/named` fallback fetch, or a cache entry in a
 *   workspace whose cache has never been bulk-downloaded (where every entry was
 *   written by exactly such a fetch).
 * - `none`: nothing was found — an unknown name, a cache-only lookup that
 *   missed, or a failed fetch.
 */
export type PrintingsSource = 'complete' | 'partial' | 'none'

/** A printings lookup result carrying {@link PrintingsSource} provenance. */
export type CardPrintingsResult = {
  printings: ScryfallCard[]
  source: PrintingsSource
}

/**
 * Whether a printings list may be read as the card's complete printing set.
 * A `partial` list may hold a single arbitrary printing, so treating it as
 * exhaustive assigns printings the user never chose and rejects pins that
 * really exist.
 */
export function printingsAreComplete(result: CardPrintingsResult): boolean {
  return result.source === 'complete'
}

/**
 * Returns true when an entry is pinned to a specific printing — i.e. it has both
 * a set code and a collector number. A set or collector number alone does not
 * identify a printing. Doubles as a type guard narrowing both fields to `string`.
 */
export function hasSpecificPrinting<T extends PrintingFields>(
  entry: T,
): entry is T & SpecificPrinting {
  return Boolean(entry.set && entry.collectorNumber)
}

/**
 * Find the printing in `printings` matching the given set and collector number,
 * both compared case-insensitively. Returns undefined when the list is missing,
 * the set/collector number is absent, or no printing matches.
 *
 * Collector numbers are stored exactly as the line (or the cache) spelled them,
 * but they identify a printing rather than being display text — so `507A` and
 * `507a` are the same printing, which is also how the collection sync's own join
 * key compares them. A stricter comparison here would drop such a line out of a
 * CSV upload and report it as missing from a cache that in fact holds it.
 *
 * Centralizes the `printings.find(p => p.set === … && p.collector_number === …)`
 * pattern used wherever a specific printing must be resolved from a card's full
 * printing list (deck/collection/wanted rendering, static-site generation, and
 * pricing).
 *
 * Language-aware: when `language` is given (or defaulted — a missing value
 * means `en`, and a card object with no `lang` is likewise treated as `en`),
 * the card object in that language wins. When the cache holds no object in the
 * requested language, the English object for the same `set:cn` is the
 * fallback — it is the printing's default object, carrying prices and images —
 * and failing that, whatever object the cache does hold for that `set:cn`.
 */
export function findPrinting(
  printings: ScryfallCard[] | undefined,
  set: string | undefined,
  collectorNumber: string | undefined,
  language?: CardLanguage,
): ScryfallCard | undefined {
  if (!printings || !set || !collectorNumber) return undefined
  const lowerSet = set.toLowerCase()
  const lowerNumber = collectorNumber.toLowerCase()
  const candidates = printings.filter(
    (p) => p.set.toLowerCase() === lowerSet && p.collector_number.toLowerCase() === lowerNumber,
  )
  const wanted = displayLanguage(language)
  return (
    candidates.find((p) => scryfallCardLanguage(p) === wanted) ??
    candidates.find((p) => scryfallCardLanguage(p) === 'en') ??
    candidates[0]
  )
}

/**
 * Every language the cache holds a card object in for one `set:cn` printing,
 * in {@link CARD_LANGUAGES} canonical order (deduped; an object with no `lang`
 * counts as `en`). Empty when the printing is not in the list at all. Callers
 * should mind {@link PrintingsSource}: only a `complete` list — and then only
 * one built from the `all_cards` bulk — can be read as "these are all the
 * languages this printing exists in".
 */
export function printingLanguages(
  printings: ScryfallCard[] | undefined,
  set: string | undefined,
  collectorNumber: string | undefined,
): CardLanguage[] {
  if (!printings || !set || !collectorNumber) return []
  const lowerSet = set.toLowerCase()
  const lowerNumber = collectorNumber.toLowerCase()
  const found = new Set<CardLanguage>()
  for (const p of printings) {
    if (p.set.toLowerCase() !== lowerSet || p.collector_number.toLowerCase() !== lowerNumber) {
      continue
    }
    found.add(scryfallCardLanguage(p))
  }
  // Every member is a CardLanguage, so the canonical sort cannot reorder an
  // unknown code into the list — the cast just restores the element type.
  return sortLanguages(found) as CardLanguage[]
}

/**
 * Collapse a printings list to one card object per `set:cn` printing — under an
 * `all_cards` cache a printing appears once per language, and pickers must
 * offer printings, not language objects. The English (default) object wins each
 * printing's slot whatever order the list arrived in; a printing available in
 * no other language keeps its sole foreign object. Order is the input's
 * first-appearance order (Map insertion order), so upstream sorting (release
 * date, `comparePrintings`) shows through.
 */
export function dedupePrintingsByKey(printings: ScryfallCard[]): ScryfallCard[] {
  const byKey = new Map<string, ScryfallCard>()
  for (const p of printings) {
    const key = cardPrintingKey(p)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, p)
    } else if (scryfallCardLanguage(existing) !== 'en' && scryfallCardLanguage(p) === 'en') {
      byKey.set(key, p)
    }
  }
  return [...byKey.values()]
}
