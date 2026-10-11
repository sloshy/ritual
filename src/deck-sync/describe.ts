/**
 * How a deck sync words its changes: the per-deck `Changes:` count line and the
 * per-card detail line for each {@link DeckSyncCardChange}. The engine logs both;
 * the admin Sync Decks page renders the same text from a finished report when
 * it ran without the progress stream.
 *
 * Side-effect free, and a browser-safe leaf (the admin bundle imports it); the
 * output follows the active locale.
 */

import { formatCardCategories } from '../card/card-categories'
import { formatPrintingAnnotation } from '../changes/change-event'
import { t } from '../i18n/t'
import { describeSyncCard, itemChangeLines, type ItemChangeLine } from '../sync/describe'
import type { SyncDirection } from '../sync/common'
import type { DeckSyncCardChange, DeckSyncPrinting } from './types'

/** An absent finish is the bare-line default. */
function finishOf(printing: DeckSyncPrinting): string {
  return printing.finish ?? 'nonfoil'
}

/**
 * One side of a printing change: `(LEA:270) [foil]`. The finish is spelled out
 * on both sides — `[nonfoil]` included — whenever it is part of what changed,
 * so a finish-only change reads `[nonfoil] → [foil]` rather than as a change
 * from no printing at all. A side stating nothing reads as a placeholder.
 */
function describePrintingSide(printing: DeckSyncPrinting, finishChanged: boolean): string {
  const set = formatPrintingAnnotation({
    set: printing.set,
    collectorNumber: printing.collectorNumber,
  }).trim()
  const finish = finishOf(printing)
  const parts = [set]
  if (finishChanged || finish !== 'nonfoil') parts.push(`[${finish}]`)
  return parts.filter((part) => part !== '').join(' ') || t('domain.sync.detailNoPrinting')
}

/** The detail line for one card change, e.g. `+ 2 Sol Ring (C21:263) to Main`. */
export function describeDeckCardChange(change: DeckSyncCardChange): string {
  switch (change.kind) {
    case 'added':
      return t('domain.sync.detailAdded', {
        quantity: change.quantity,
        card: describeSyncCard(change.name, change.printing),
        place: change.board,
      })
    case 'removed':
      return t('domain.sync.detailRemoved', {
        quantity: change.quantity,
        card: describeSyncCard(change.name, change.printing),
        place: change.board,
      })
    case 'quantity':
      return t('domain.sync.detailQuantity', {
        card: describeSyncCard(change.name, change.printing),
        place: change.board,
        from: change.from,
        to: change.to,
      })
    case 'move':
      return t('domain.sync.detailMove', {
        quantity: change.quantity,
        card: describeSyncCard(change.name, change.printing),
        from: change.from,
        to: change.to,
      })
    case 'printing': {
      const finishChanged = finishOf(change.from) !== finishOf(change.to)
      return t('domain.sync.detailPrinting', {
        card: change.name,
        place: change.board,
        from: describePrintingSide(change.from, finishChanged),
        to: describePrintingSide(change.to, finishChanged),
      })
    }
    case 'categories':
      return t('domain.sync.detailCategories', {
        card: change.name,
        categories: formatCardCategories(change.categories) || t('domain.sync.detailNoCategories'),
      })
    default: {
      const unhandled: never = change
      throw new Error(`Unhandled card change: ${JSON.stringify(unhandled)}`)
    }
  }
}

/** What a deck sync's `Changes:` line counts: card changes by kind. */
export type DeckChangeCounts = {
  added: number
  removed: number
  quantity: number
  moves: number
  printings: number
  /** Cards whose categories change; absent when the run did not sync categories. */
  categories?: number
}

/**
 * Count a deck's card changes by kind. `syncCategories` decides whether the
 * line has a categories clause at all — a run syncing categories says so even
 * when none changed.
 */
export function deckChangeCounts(
  changes: readonly DeckSyncCardChange[],
  syncCategories: boolean,
): DeckChangeCounts {
  const count = (kind: DeckSyncCardChange['kind']): number =>
    changes.filter((change) => change.kind === kind).length
  return {
    added: count('added'),
    removed: count('removed'),
    quantity: count('quantity'),
    moves: count('move'),
    printings: count('printing'),
    ...(syncCategories ? { categories: count('categories') } : {}),
  }
}

/**
 * A deck's change counts as the run log states them, e.g.
 * `+2 added, -1 removed, ~0 quantity changed` on a pull and
 * `+2 to add, -1 to remove, ~0 quantity changes` on a push, with a clause for
 * board moves and printings when there are any and for categories when the
 * run synced them.
 */
export function describeDeckChangeSummary(
  direction: SyncDirection,
  counts: DeckChangeCounts,
): string {
  const moves =
    counts.moves > 0
      ? t('domain.sync.deckMovesClause', {
          moves: t('domain.count.boardMoves', { count: counts.moves }),
        })
      : ''
  const printings =
    counts.printings > 0
      ? t('domain.sync.deckPrintingsClause', {
          direction,
          printings: t('domain.count.printings', { count: counts.printings }),
        })
      : ''
  const categories =
    counts.categories === undefined
      ? ''
      : t('domain.sync.deckCategoriesClause', {
          direction,
          cards: t('domain.count.cardCategories', { count: counts.categories }),
        })
  const base = t('domain.sync.deckCounts', {
    direction,
    added: counts.added,
    removed: counts.removed,
    quantity: counts.quantity,
  })
  return `${base}${moves}${printings}${categories}`
}

/** The `Changes: …` line a deck sync logs for a deck with changes. */
export function describeDeckChangesLine(
  direction: SyncDirection,
  counts: DeckChangeCounts,
): string {
  return `Changes: ${describeDeckChangeSummary(direction, counts)}`
}

/**
 * A deck's change lines as a finished report states them: its `Changes:` count
 * line, then a detail line per card — the order the stream logs them in.
 * Empty for a deck with no changes. `describe` defaults to
 * {@link describeDeckCardChange}; a replay passes one that tolerates a change
 * kind this build does not know.
 */
export function deckItemLines(
  direction: SyncDirection,
  changes: readonly DeckSyncCardChange[],
  syncCategories: boolean,
  describe: (change: DeckSyncCardChange) => string = describeDeckCardChange,
): ItemChangeLine[] {
  if (changes.length === 0) return []
  return itemChangeLines(
    describeDeckChangesLine(direction, deckChangeCounts(changes, syncCategories)),
    changes.map(describe),
  )
}
