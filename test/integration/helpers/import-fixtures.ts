import fs from 'node:fs/promises'
import path from 'node:path'
import type { ArchidektDeckResponse } from '../../../src/importers/archidekt-types'

/**
 * The one-deck Archidekt fixture the URL-import suites share: a foil Sol Ring
 * (LTC:284) in a deck named `Imported Deck`. Both the CLI and the admin
 * handler suite assert on the same derived line, so the fixture lives once.
 *
 * Deliberately not in `helpers/archidekt.ts` — that harness pulls in the card
 * cache and the collection-sync fixtures, which these suites do not need.
 */
export const ARCHIDEKT_DECK_ID = '123456'

/** The URL the import fetches, for a `stubFetch` route key. */
export const ARCHIDEKT_DECK_URL = `https://archidekt.com/api/decks/${ARCHIDEKT_DECK_ID}/`

export const REMOTE_FOIL_DECK = {
  name: 'Imported Deck',
  deckFormat: 3,
  categories: [{ id: 1, name: 'Main' }],
  cards: [
    {
      quantity: 1,
      modifier: 'Foil',
      card: {
        name: 'Sol Ring',
        oracleCard: { name: 'Sol Ring' },
        collectorNumber: '284',
        edition: { editioncode: 'ltc' },
      },
      categories: [1],
    },
  ],
} as const satisfies ArchidektDeckResponse

/** The same deck with its entries stating no printing at all — nothing to decide. */
export const REMOTE_BARE_DECK = {
  name: 'Imported Deck',
  deckFormat: 3,
  categories: [{ id: 1, name: 'Main' }],
  cards: [
    {
      quantity: 1,
      card: { name: 'Sol Ring', oracleCard: { name: 'Sol Ring' } },
      categories: [1],
    },
  ],
} as const satisfies ArchidektDeckResponse

/** The deck file a fixture import writes — saveDeck keeps the display name. */
export async function readImportedDeck(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, 'decks', 'Imported Deck.md'), 'utf-8')
}
