import type { Card } from '../card/card'

/**
 * The canonical deck formats. This is the *only* vocabulary a deck's `format`
 * may take: every surface that reads a format (file front matter, CLI flag,
 * admin form, Archidekt, Moxfield) runs its input through {@link parseDeckFormat}
 * first, and every surface that writes a deck persists the key it returns.
 */
export type DeckFormatKey =
  | 'commander'
  | 'oathbreaker'
  | 'standard'
  | 'modern'
  | 'pioneer'
  | 'legacy'
  | 'vintage'
  | 'pauper'
  | 'historic'
  | 'alchemy'
  | 'explorer'
  | 'timeless'
  | 'penny-dreadful'
  | 'brawl'
  | 'historic-brawl'
  | 'duel-commander'
  | 'pauper-commander'
  | 'pre-dh'
  | 'pre-modern'
  | 'limited'

/**
 * The canonical deck boards a section header normalizes to. Archidekt buckets every
 * card into one of these, and downloaded decks are written with these exact headers.
 * Section-name classification lives in `deck-format.ts` (`isCommanderSection`, etc.);
 * `normalizeBoard` in `deck-sync/diff.ts` maps a header to one of these values.
 */
export const BOARDS = ['Commander', 'Main', 'Sideboard', 'Maybeboard'] as const
export type Board = (typeof BOARDS)[number]
/**
 * The implicit section name applied to card entries that have no explicit `## Section`
 * header. Cards parsed before the first header (or from a flat, section-less file) belong
 * to this section, and it is written out explicitly on the next save. Matches the deck
 * convention where ungrouped cards live in `Main`.
 */
export const DEFAULT_SECTION = 'Main'

export interface DeckSection {
  name: string
  cards: Card[]
}

export interface DeckData {
  name: string
  /** Canonical format key; set only from `parseDeckFormat`, never raw text. */
  format?: DeckFormatKey
  sourceId?: string
  sourceUrl?: string
  description?: string
  primer?: string
  sections: DeckSection[]
}
