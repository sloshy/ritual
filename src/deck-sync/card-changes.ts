/**
 * The structured per-card change list a deck sync reports for each deck — the
 * one source the CLI's `--verbose` lines, the admin page and the MCP report
 * all read. Side-effect free.
 */

import type { SetCategoriesChange } from '../changes/change-event'
import { appliedPrinting, type DeckDiff } from './diff'
import type { DeckPrintingRef } from './reconcile'
import type { DeckSyncCardAdded, DeckSyncCardChange } from './types'

/**
 * One card's categories as a run sets them, primary first. Shaped like a
 * `set-categories` change event, so a pull's category changes and a push
 * plan's `categoriesChanged` pass straight in.
 */
export type CategoryChangeInput = Pick<SetCategoriesChange, 'cardName' | 'categories'>

/** The optional `printing` field, present only when the diff entry carries one. */
function withPrinting(printing: DeckPrintingRef | undefined): Pick<DeckSyncCardAdded, 'printing'> {
  return printing === undefined ? {} : { printing }
}

/**
 * Every card change in a (filtered) deck diff plus the run's category changes,
 * in the order the `Changes:` summary counts them: additions, removals,
 * quantity changes, board moves, printing changes, categories. The caller
 * narrows the diff by `only` first, so only what the run applies is listed.
 */
export function deckSyncCardChanges(
  diff: DeckDiff,
  categories: readonly CategoryChangeInput[],
): DeckSyncCardChange[] {
  return [
    ...diff.added.map((card): DeckSyncCardChange => ({
      kind: 'added',
      name: card.name,
      quantity: card.totalQuantity,
      board: card.board,
      ...withPrinting(card.printing),
    })),
    ...diff.removed.map((card): DeckSyncCardChange => ({
      kind: 'removed',
      name: card.name,
      quantity: card.totalQuantity,
      board: card.board,
      ...withPrinting(card.printing),
    })),
    ...diff.quantityChanged.map((change): DeckSyncCardChange => ({
      kind: 'quantity',
      name: change.name,
      board: change.board,
      from: change.oldQty,
      to: change.newQty,
      ...withPrinting(change.printing),
    })),
    ...diff.boardMoves.map((move): DeckSyncCardChange => ({
      kind: 'move',
      name: move.name,
      quantity: move.quantity,
      from: move.from,
      to: move.to,
      ...withPrinting(move.printing),
    })),
    ...diff.printingUpdates.map((update): DeckSyncCardChange => ({
      kind: 'printing',
      name: update.name,
      board: update.board,
      from: update.from,
      // What the copies end up holding: a finish-only update keeps the
      // destination's edition, the same key the quantity entries use.
      to: appliedPrinting(update.from, update.to),
    })),
    ...categories.map((change): DeckSyncCardChange => ({
      kind: 'categories',
      name: change.cardName,
      categories: [...change.categories],
    })),
  ]
}
