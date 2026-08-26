import type { PrintingTuple } from './change-event'

/**
 * Targeting is deliberately name/set/collector-number/cardId-based — an
 * entry's language (like its finish or condition) is an *attribute* a change
 * edits, not part of how a change finds its target. A `set-language` change
 * therefore targets exactly like `set-finish` does, and two same-printing
 * entries differing only by language are disambiguated by `cardId`/`fileOrder`.
 */
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
    language: entry.language,
  }
}

/**
 * Find one flat entry by card ID, falling back to its name. The id match wins
 * outright rather than being folded into one `(id || name)` predicate: a
 * combined predicate returns the *first* same-name entry, so a list holding the
 * same card twice — say one pinned copy and one name-only line — would answer
 * for the wrong one. Every per-entry attribute lookup (finish, language,
 * labels) resolves this way; decks are nested by section and have their own.
 *
 * The id must also *agree* with the name. `&N` is released to a reuse pool when
 * a line is removed, so the same id can name a different card in the on-disk
 * baseline than it does in the edited data — and these lookups run against both.
 * Requiring the name costs nothing on a live lookup (the tile's id and name come
 * from the same entry) and stops a recycled id from answering for the card that
 * used to hold it.
 */
export function findEntryByIdOrName<T extends TargetableEntry>(
  entries: readonly T[],
  cardName: string,
  cardId?: number,
): T | undefined {
  if (cardId !== undefined) {
    const byId = entries.find((e) => e.cardId === cardId && e.name === cardName)
    if (byId) return byId
  }
  return entries.find((e) => e.name === cardName)
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
