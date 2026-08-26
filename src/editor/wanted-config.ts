import type { WantedListCardEntry } from '../site/data-types'
import { type PrintingTuple, isSamePrinting } from '../changes/change-event'
import type { ChangePrintingContext } from './useEditor'
import { applyChangeToWantedList } from './wanted-changes'
import { findEntryPrintingById } from './entry-targeting'
import type { FlatPrinting } from './flat-list-controller'

/** Printing fields logged when a wanted entry is added/removed (wanted lists carry no condition). */
export function wantedPrintingOf(entry: WantedListCardEntry): FlatPrinting {
  return {
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    language: entry.language,
  }
}

/**
 * Apply a "change printing" action to a wanted list. Each row is a single entry,
 * so this simply retargets that entry with one set-printing change. Wanted-list
 * entries carry no condition, so none is set here.
 */
export function applyWantedChangePrinting(ctx: ChangePrintingContext<WantedListCardEntry[]>): void {
  const { target, options, tools, setData, original } = ctx
  const cardId = target.cardIds[0]
  if (cardId === undefined) return

  // `language` rides along when the picker resolved one (a printing unavailable
  // in the default language); absent, the set-printing leaves the entry's
  // language alone.
  const newPrinting: PrintingTuple = {
    set: options.set,
    collectorNumber: options.collectorNumber,
    finish: options.finish,
    language: options.language,
  }
  const currentPrinting: PrintingTuple = {
    set: target.set,
    collectorNumber: target.collectorNumber,
    finish: target.finish,
  }
  if (isSamePrinting(newPrinting, currentPrinting)) return

  const origPrinting = findEntryPrintingById(original, cardId) ?? currentPrinting
  tools.setPrinting(target.cardName, newPrinting, origPrinting, cardId)
  setData((prev) =>
    prev
      ? applyChangeToWantedList(prev, {
          action: 'set-printing',
          cardName: target.cardName,
          set: options.set,
          collectorNumber: options.collectorNumber,
          finish: options.finish,
          language: options.language,
          cardId,
        })
      : prev,
  )
}
