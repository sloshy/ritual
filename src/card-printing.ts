import type { ScryfallCard } from './types'

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
 */
export function findPrinting(
  printings: ScryfallCard[] | undefined,
  set: string | undefined,
  collectorNumber: string | undefined,
): ScryfallCard | undefined {
  if (!printings || !set || !collectorNumber) return undefined
  const lowerSet = set.toLowerCase()
  const lowerNumber = collectorNumber.toLowerCase()
  return printings.find(
    (p) => p.set.toLowerCase() === lowerSet && p.collector_number.toLowerCase() === lowerNumber,
  )
}
