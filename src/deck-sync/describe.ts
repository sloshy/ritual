/**
 * The per-card detail line for each {@link DeckSyncCardChange} — what a deck
 * sync logs under its `Changes:` summary at the `detail` level, and what the
 * admin Sync Decks page renders from a finished report when it ran without
 * the progress stream.
 *
 * Side-effect free, and a browser-safe leaf (the admin bundle imports it); the
 * output follows the active locale.
 */

import { formatCardCategories } from '../card/card-categories'
import { formatPrintingAnnotation } from '../changes/change-event'
import { t } from '../i18n/t'
import { describeSyncCard } from '../sync/describe'
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
