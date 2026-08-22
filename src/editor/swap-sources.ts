/**
 * Shared mapping from list contents to the swap planner's source entries —
 * the half of a {@link SwapSourceProvider} that does not depend on where the
 * lists came from (the public site's baked JSON or the admin API).
 */

import type { SwapSourceEntry } from './swap-printings'

/**
 * A flat-list entry (collection or wanted) as a source, and the shape the
 * target builder reads too: one entry is one copy, so it is a source entry
 * minus the quantity. `finish` is passed through as the list reports it — the
 * resolved display finish on a baked collection entry, the line's own token on
 * an admin one — and the planner resolves the display finish either way.
 */
export type SwapFlatLine = Omit<SwapSourceEntry, 'quantity'>

/** A deck line as a source: a source entry whose section the caller supplies. */
export type SwapDeckLine = Omit<SwapSourceEntry, 'section'>

/** A deck section as a source: its name and lines. */
export type SwapDeckSection = { name: string; cards: readonly SwapDeckLine[] }

/** Copy only the fields that are set, so an entry never carries `undefined` keys. */
function printingFields(line: SwapFlatLine | SwapDeckLine): SwapFlatLine {
  const entry: SwapFlatLine = { name: line.name }
  if (line.set !== undefined) entry.set = line.set.toLowerCase()
  if (line.collectorNumber !== undefined) entry.collectorNumber = line.collectorNumber
  if (line.finish !== undefined) entry.finish = line.finish
  if (line.condition !== undefined) entry.condition = line.condition
  if (line.language !== undefined) entry.language = line.language
  if (line.cardId !== undefined) entry.cardId = line.cardId
  return entry
}

/** A deck's sections as source entries: one per line, carrying its quantity and section. */
export function deckSectionsToSwapEntries(sections: readonly SwapDeckSection[]): SwapSourceEntry[] {
  const entries: SwapSourceEntry[] = []
  for (const section of sections) {
    for (const card of section.cards) {
      entries.push({ ...printingFields(card), quantity: card.quantity, section: section.name })
    }
  }
  return entries
}

/** A flat list's entries as source entries: one per copy (`quantity: 1`), keeping its section. */
export function flatEntriesToSwapEntries(lines: readonly SwapFlatLine[]): SwapSourceEntry[] {
  return lines.map((line) => {
    const entry: SwapSourceEntry = { ...printingFields(line), quantity: 1 }
    if (line.section !== undefined) entry.section = line.section
    return entry
  })
}
