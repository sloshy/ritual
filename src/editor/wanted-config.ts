import type { WantedListCardEntry } from '../list/site-data'
import { printingRetarget } from './printing-retarget'
import type { ChangePrintingContext } from './editor-config'
import { applyChangeToWantedList } from '../changes/wanted-changes'
import { findEntryPrintingById } from '../changes/entry-targeting'
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

  // Wanted lines carry no condition, so the comparison names none.
  const retarget = printingRetarget(target, options, 'ignore-condition')
  if (retarget === null) return
  const { newPrinting, currentPrinting } = retarget

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
