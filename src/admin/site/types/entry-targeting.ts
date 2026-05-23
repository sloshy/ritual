import type { PrintingTuple } from '../../../change-event'

export type TargetableEntry = {
  cardId?: number
  fileOrder?: number
  name: string
  set?: string
  collectorNumber?: string
}

/** A flat entry that carries a printing, looked up by its card ID. */
export type PrintableEntry = PrintingTuple & { cardId?: number }

/**
 * Resolve a flat entry's current printing by card ID, for change-printing revert
 * detection. Returns undefined when no entry has that ID. (Decks are nested by
 * section and have their own lookup.)
 */
export function findEntryPrintingById(
  entries: PrintableEntry[] | null,
  cardId: number,
): PrintingTuple | undefined {
  const entry = entries?.find((e) => e.cardId === cardId)
  if (!entry) return undefined
  return {
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    condition: entry.condition,
  }
}

export type TargetingChange = {
  cardId?: number
  cardName: string
  fileOrder?: number
  set?: string
  collectorNumber?: string
}

/**
 * Find the index of an entry matching the change, using a 3-tier priority lookup:
 *   1. cardId match (if the change has a cardId)
 *   2. fileOrder fallback (if the change has a fileOrder — terminal, returns even if -1)
 *   3. Attribute fallback (name + optional set + optional collectorNumber)
 */
export function findTargetEntryIndex(entries: TargetableEntry[], change: TargetingChange): number {
  // Tier 1: cardId match
  if (change.cardId !== undefined) {
    const idx = entries.findIndex((e) => e.cardId === change.cardId)
    if (idx !== -1) return idx
  }

  // Tier 2: fileOrder fallback (terminal — returns even if -1)
  if (change.fileOrder !== undefined) {
    return entries.findIndex((e) => e.fileOrder === change.fileOrder)
  }

  // Tier 3: attribute fallback (name + optional set + optional collectorNumber)
  return entries.findIndex((e) => {
    if (e.name !== change.cardName) return false
    if (change.set && e.set?.toLowerCase() !== change.set.toLowerCase()) return false
    if (change.collectorNumber && e.collectorNumber !== change.collectorNumber) return false
    return true
  })
}
