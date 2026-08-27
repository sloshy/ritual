import { isCommanderSection, isExtraSection, isSideboardSection } from '../list/deck-format'

/** The one field {@link partitionDeckCards} reads off a card. */
export type SectionedCard = { section: string }

/**
 * A deck's cards split by the section they live in. The four buckets are
 * exhaustive and disjoint: every card lands in exactly one, tested in the order
 * commander → sideboard → extras → mainboard, so a section named for two of them
 * ("Commander Sideboard") resolves the same way everywhere the page reads it.
 */
export type DeckCardPartition<C> = {
  commanderCards: C[]
  sideboardCards: C[]
  extraCards: C[]
  mainboardCards: C[]
}

/**
 * Partition a deck's cards in a single O(n) pass, so the page neither re-scans
 * the list per bucket nor groups anything but the mainboard.
 *
 * This is the page's *display* split, with no oathbreaker branch — an
 * oathbreaker/signature-spell section is mainboard here, unlike the counting
 * rule in `isMainDeckSection` (`list/deck-format`).
 */
export function partitionDeckCards<C extends SectionedCard>(
  cards: readonly C[],
): DeckCardPartition<C> {
  const commanderCards: C[] = []
  const sideboardCards: C[] = []
  const extraCards: C[] = []
  const mainboardCards: C[] = []
  for (const c of cards) {
    if (isCommanderSection(c.section)) commanderCards.push(c)
    else if (isSideboardSection(c.section)) sideboardCards.push(c)
    else if (isExtraSection(c.section)) extraCards.push(c)
    else mainboardCards.push(c)
  }
  return { commanderCards, sideboardCards, extraCards, mainboardCards }
}

/**
 * Rebuild the deck hash for a primer toggle, preserving any shareable list-view
 * query string. `hash` is the current `window.location.hash`, passed in rather
 * than read so the rule is testable without a DOM.
 */
export function deckPrimerHash(slug: string, primerOpen: boolean, hash: string): string {
  const query = hash.split('?')[1]
  const base = `#/deck/${slug}${primerOpen ? '/primer' : ''}`
  return query ? `${base}?${query}` : base
}
