import { batch } from 'solid-js'
import type { CollectionCardEntry } from '../site/data-types'
import { type PrintingTuple, isSamePrinting } from '../change-event'
import type { ChangePrintingContext } from './useEditor'
import { applyChangeToCollection } from './collection-changes'
import { findEntryPrintingById } from './entry-targeting'
import type { FlatPrinting } from './flat-list-controller'
import { storedLanguage } from '../card-language'

/** Printing fields logged when a collection entry is added/removed (includes condition). */
export function collectionPrintingOf(entry: CollectionCardEntry): FlatPrinting {
  return {
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    condition: entry.condition,
    // Entries resolve language on load, so `en` is stored explicitly; fold it
    // back to the written-value shape (omitted means English) for the change log.
    language: storedLanguage(entry.language),
  }
}

/**
 * Apply a "change printing" action to a collection. Each grouped copy is its own
 * single-card entry, so this retargets the first `count` entries of the tile's
 * group, emitting one set-printing change per entry. Untouched copies keep the
 * old printing and re-group into a separate tile.
 */
export function applyCollectionChangePrinting(
  ctx: ChangePrintingContext<CollectionCardEntry[]>,
): void {
  const { target, count, options, tools, setData, original } = ctx
  // `language` rides along when the picker resolved one (a printing unavailable
  // in the default language); absent, the set-printing leaves the entry's
  // language alone.
  const newPrinting: PrintingTuple = {
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    condition: options.condition,
    language: options.language,
  }
  const currentPrinting: PrintingTuple = {
    set: target.set,
    collectorNumber: target.collectorNumber,
    finish: target.finish,
    condition: target.condition,
  }
  if (isSamePrinting(newPrinting, currentPrinting)) return

  const n = Math.min(Math.max(count, 1), target.cardIds.length)
  batch(() => {
    for (const cardId of target.cardIds.slice(0, n)) {
      const origPrinting = findEntryPrintingById(original, cardId) ?? currentPrinting
      tools.setPrinting(target.cardName, newPrinting, origPrinting, cardId)
      setData((prev) =>
        prev
          ? applyChangeToCollection(prev, {
              action: 'set-printing',
              cardName: target.cardName,
              set: options.set,
              collectorNumber: options.collectorNumber,
              finish: options.finish,
              condition: options.condition,
              language: options.language,
              cardId,
            })
          : prev,
      )
    }
  })
}
