/**
 * How many lines and copies a list holds, per section — the counts a summary
 * reports. One module so every surface that counts a list (a list load's
 * `view=summary`, the cross-list summary) counts it the same way.
 *
 * Pure, and never touches the card cache: a count is a statement about the
 * file, not about the cards in it.
 */

import { DEFAULT_SECTION, type DeckData } from './deck'

/** Per-section tallies in a summary. */
export interface ListSectionCount {
  name: string
  /** Lines in the section. */
  entryCount: number
  /** Copies in the section (summed quantity). */
  cardCount: number
}

/** A summary's counts: lines, copies, and the per-section breakdown. */
export interface ListCounts {
  entryCount: number
  cardCount: number
  sections: ListSectionCount[]
}

/**
 * Count a deck: `entryCount` is lines, `cardCount` is copies (summed quantity),
 * and every section present is reported even when it holds a single line.
 */
export function countDeck(deck: Pick<DeckData, 'sections'>): ListCounts {
  const sections: ListSectionCount[] = deck.sections.map((section) => ({
    name: section.name,
    entryCount: section.cards.length,
    cardCount: section.cards.reduce((total, card) => total + card.quantity, 0),
  }))
  return {
    entryCount: sections.reduce((total, section) => total + section.entryCount, 0),
    cardCount: sections.reduce((total, section) => total + section.cardCount, 0),
    sections,
  }
}

/**
 * Count flat entries: `entryCount` is lines, `cardCount` is copies summed
 * through `quantityOf`. Collections and wanted lists hold one copy per line
 * today, so the default counts each line once and the two numbers agree — they
 * are both reported anyway so a client reads the same two fields whatever the
 * list type. Section order follows first appearance.
 */
export function countEntries<T>(
  entries: readonly T[],
  sectionOf: (entry: T) => string | undefined,
  quantityOf: (entry: T) => number = () => 1,
): ListCounts {
  const bySection = new Map<string, ListSectionCount>()
  for (const entry of entries) {
    const name = sectionOf(entry) ?? DEFAULT_SECTION
    const section = bySection.get(name) ?? { name, entryCount: 0, cardCount: 0 }
    section.entryCount += 1
    section.cardCount += quantityOf(entry)
    bySection.set(name, section)
  }
  const sections = [...bySection.values()]
  return {
    entryCount: entries.length,
    cardCount: sections.reduce((total, section) => total + section.cardCount, 0),
    sections,
  }
}
