/**
 * How a deck sync words its changes: the per-deck `Changes:` count line and the
 * per-card detail line for each {@link DeckSyncCardChange}. The engine logs both;
 * the admin Sync Decks page renders the same text from a finished report when
 * it ran without the progress stream.
 *
 * Side-effect free, and a browser-safe leaf (the admin bundle imports it). Each
 * describer returns a message reference rather than text: the engine sends it
 * on as English plus key, and every surface renders it in its reader's locale
 * (`renderSyncMessage`).
 */

import { formatCardCategories } from '../card/card-categories'
import { formatPrintingAnnotation } from '../changes/change-event'
import { t } from '../i18n/t'
import { describeSyncCard, itemChangeLines, type ItemChangeLine } from '../sync/describe'
import type { SyncDirection } from '../sync/common'
import {
  syncList,
  syncMessage,
  syncRef,
  type SyncMessage,
  type SyncMessageRef,
  type SyncParam,
  type SyncText,
} from '../sync/message'
import { sectionNameParam } from '../list/deck-format'
import type { DeckSyncCardChange, DeckSyncPrinting } from './types'
import type { MoveShortfall } from './diff'

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
function describePrintingSide(printing: DeckSyncPrinting, finishChanged: boolean): SyncParam {
  const set = formatPrintingAnnotation({
    set: printing.set,
    collectorNumber: printing.collectorNumber,
  }).trim()
  const finish = finishOf(printing)
  const parts = [set]
  if (finishChanged || finish !== 'nonfoil') parts.push(`[${finish}]`)
  // Card-line grammar (`(LEA:270) [foil]`), never translated; only the placeholder is.
  return parts.filter((part) => part !== '').join(' ') || syncRef('domain.sync.detailNoPrinting')
}

/**
 * A pull's warning that Archidekt moved copies the local file does not hold on
 * the source board: both boards nested, named in the reader's language.
 */
export function describeMoveShortfall(shortfall: MoveShortfall): SyncMessage {
  return syncMessage('domain.sync.moveShortfall', {
    count: shortfall.quantity,
    card: shortfall.name,
    from: sectionNameParam(shortfall.from),
    to: sectionNameParam(shortfall.to),
  })
}

/** The detail line for one card change, e.g. `+ 2 Sol Ring (C21:263) to Main`. */
export function describeDeckCardChange(change: DeckSyncCardChange): SyncMessageRef {
  switch (change.kind) {
    case 'added':
      return syncRef('domain.sync.detailAdded', {
        quantity: change.quantity,
        card: describeSyncCard(change.name, change.printing),
        place: sectionNameParam(change.board),
      })
    case 'removed':
      return syncRef('domain.sync.detailRemoved', {
        quantity: change.quantity,
        card: describeSyncCard(change.name, change.printing),
        place: sectionNameParam(change.board),
      })
    case 'quantity':
      return syncRef('domain.sync.detailQuantity', {
        card: describeSyncCard(change.name, change.printing),
        place: sectionNameParam(change.board),
        from: change.from,
        to: change.to,
      })
    case 'move':
      return syncRef('domain.sync.detailMove', {
        quantity: change.quantity,
        card: describeSyncCard(change.name, change.printing),
        from: sectionNameParam(change.from),
        to: sectionNameParam(change.to),
      })
    case 'printing': {
      const finishChanged = finishOf(change.from) !== finishOf(change.to)
      return syncRef('domain.sync.detailPrinting', {
        card: change.name,
        place: sectionNameParam(change.board),
        from: describePrintingSide(change.from, finishChanged),
        to: describePrintingSide(change.to, finishChanged),
      })
    }
    case 'categories':
      return syncRef('domain.sync.detailCategories', {
        card: change.name,
        categories:
          formatCardCategories(change.categories) || syncRef('domain.sync.detailNoCategories'),
      })
    default: {
      const unhandled: never = change
      throw new Error(t('domain.sync.unhandledCardChange', { change: JSON.stringify(unhandled) }))
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
): SyncParam {
  // The clauses carry their own leading separator in the catalog, so they are
  // concatenated as they are.
  const clauses: SyncParam[] = [
    syncRef('domain.sync.deckCounts', {
      direction,
      added: counts.added,
      removed: counts.removed,
      quantity: counts.quantity,
    }),
  ]
  if (counts.moves > 0) {
    clauses.push(
      syncRef('domain.sync.deckMovesClause', {
        moves: syncRef('domain.count.boardMoves', { count: counts.moves }),
      }),
    )
  }
  if (counts.printings > 0) {
    clauses.push(
      syncRef('domain.sync.deckPrintingsClause', {
        direction,
        printings: syncRef('domain.count.printings', { count: counts.printings }),
      }),
    )
  }
  if (counts.categories !== undefined) {
    clauses.push(
      syncRef('domain.sync.deckCategoriesClause', {
        direction,
        cards: syncRef('domain.count.cardCategories', { count: counts.categories }),
      }),
    )
  }
  return syncList(clauses, 'concat')
}

/** The `Changes: …` line a deck sync logs for a deck with changes. */
export function describeDeckChangesLine(
  direction: SyncDirection,
  counts: DeckChangeCounts,
): SyncMessageRef {
  return syncRef('domain.sync.changesLine', {
    summary: describeDeckChangeSummary(direction, counts),
  })
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
  describe: (change: DeckSyncCardChange) => SyncText = describeDeckCardChange,
): ItemChangeLine[] {
  if (changes.length === 0) return []
  return itemChangeLines(
    describeDeckChangesLine(direction, deckChangeCounts(changes, syncCategories)),
    changes.map(describe),
  )
}
