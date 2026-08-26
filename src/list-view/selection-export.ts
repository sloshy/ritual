import type { SelectedCard } from './useCardSelection'
import { aggregateQuantities, printingSuffix, variantKey, type Aggregated } from '../card/card-line'
import { CSV_HEADER, csvRow } from '../list/list-export'

const aggregateSelection = (cards: SelectedCard[]): Aggregated<SelectedCard>[] =>
  aggregateQuantities(
    cards,
    (c) => variantKey(c.name, c.set, c.collectorNumber, c.finish, c.condition, c.language),
    (c) => c.quantity,
  )

/**
 * Serialize selected cards to a plain-text list, one line per distinct printing:
 * `N {Name} ({SET}:{Collector Number})`. Matches the deck "Copy" text shape and
 * the canonical set-code uppercasing.
 */
export function selectionToText(cards: SelectedCard[]): string {
  return aggregateSelection(cards)
    .map(
      ({ entry, quantity }) =>
        `${quantity} ${entry.name}${printingSuffix(entry.set, entry.collectorNumber)}`,
    )
    .join('\n')
}

/**
 * Serialize selected cards to CSV ({@link CSV_HEADER}). Mirrors {@link import('../list/list-export').collectionToCsv}
 * so a "Copy as CSV" of a whole collection matches its CSV export, but works across
 * decks and wanted lists too.
 */
export function selectionToCsv(cards: SelectedCard[]): string {
  const rows = aggregateSelection(cards).map(({ entry, quantity }) =>
    csvRow({
      name: entry.name,
      set: entry.set ?? '',
      collectorNumber: entry.collectorNumber ?? '',
      finish: entry.finish ?? '',
      condition: entry.condition ?? '',
      language: entry.language,
      quantity,
    }),
  )
  return [CSV_HEADER, ...rows].join('\n')
}
