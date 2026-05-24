import type { ScryfallCard } from './types'

type PrintingFields = { set?: string; collectorNumber?: string }
type SpecificPrinting = { set: string; collectorNumber: string }

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
 * Find the printing in `printings` matching the given set (case-insensitive) and
 * collector number. Returns undefined when the list is missing, the
 * set/collector number is absent, or no printing matches.
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
  return printings.find(
    (p) => p.set.toLowerCase() === lowerSet && p.collector_number === collectorNumber,
  )
}
