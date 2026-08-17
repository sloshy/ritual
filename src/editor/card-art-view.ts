import { parseCardIdKey, type CardArtRecord, type CardArtRef } from '../card-art'
import type { BakedDeckData } from '../site/data-types'
import type { DeckData } from '../types'
import { cardArtDisplayUrl } from '../site/art-url'

/**
 * Custom art in an editor: the raw references the load body carried, projected
 * onto the entries the list pages render.
 *
 * The references stay *outside* the editor's data. An editor's entries are the
 * value its save posts back, and custom art is written by its own route
 * (`PUT /api/art/:type/:slug`) into a sidecar no card save touches — so a
 * display URL parked on an entry would be a field the save wire type does not
 * have, on a list the sidecar already describes. The pages take their
 * `customArt` from the baked shapes, and these helpers produce exactly those.
 */

/** A list's custom art, keyed by the card line's `&N` id. */
export type CardArtRefs = ReadonlyMap<number, CardArtRef>

/** The empty map, shared so a list with no art allocates nothing. */
const NO_ART: CardArtRefs = new Map()

/** Read a load body's `customArt` object into the map the helpers below take. */
export function cardArtRefsFrom(record: CardArtRecord | undefined): CardArtRefs {
  if (record === undefined) return NO_ART
  const refs = new Map<number, CardArtRef>()
  for (const [key, ref] of Object.entries(record)) {
    // The sidecar's own key grammar, not `Number()`: a body key of `' 4'` or
    // `'4.0'` is not an `&N` and must not resolve to one.
    const cardId = parseCardIdKey(key)
    if (cardId !== null) refs.set(cardId, ref)
  }
  return refs
}

/** A flat-list entry as the art helpers see it: an id, and where the art goes. */
export type ArtDisplayEntry = {
  cardId?: number
  customArt?: string
}

/**
 * Flat-list entries with their custom art resolved to display URLs. The input
 * array is returned unchanged when the list has no art, so the common case
 * costs nothing and the pages' memos keep their identity.
 */
export function withEntryArt<E extends ArtDisplayEntry>(
  entries: E[],
  art: CardArtRefs | undefined,
): E[] {
  if (art === undefined || art.size === 0) return entries
  return entries.map((entry) => {
    const ref = entry.cardId === undefined ? undefined : art.get(entry.cardId)
    return ref === undefined ? entry : { ...entry, customArt: cardArtDisplayUrl(ref) }
  })
}

/**
 * Where a deck card's custom-art URL comes from, given its `&N` — the one thing
 * the editors and the site bakers disagree about. An editor resolves a raw
 * reference to a display URL; a build resolves it against the files it actually
 * deployed, and drops the ones it could not.
 */
export type ArtUrlFor = (cardId: number | undefined) => string | undefined

/**
 * A deck whose cards carry their custom-art display URLs, walked once for both
 * policies. Passing `undefined` means the list has no art at all: the deck is
 * returned by identity, so a deck without a sidecar is baked byte for byte as
 * before and an editor's memo keeps its reference.
 */
export function withDeckArtUrls(deck: DeckData, artUrlFor: ArtUrlFor | undefined): BakedDeckData {
  if (artUrlFor === undefined) return deck
  return {
    ...deck,
    sections: deck.sections.map((section) => ({
      ...section,
      cards: section.cards.map((card) => {
        const customArt = artUrlFor(card.cardId)
        return customArt === undefined ? card : { ...card, customArt }
      }),
    })),
  }
}

/** {@link withEntryArt} for a deck, whose cards live under its sections. */
export function withDeckArt(deck: DeckData, art: CardArtRefs | undefined): BakedDeckData {
  if (art === undefined || art.size === 0) return deck
  return withDeckArtUrls(deck, (cardId) => {
    const ref = cardId === undefined ? undefined : art.get(cardId)
    return ref === undefined ? undefined : cardArtDisplayUrl(ref)
  })
}
