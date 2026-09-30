import type { Card } from '../card/card'
import type { CardCategoryEntry } from './card-categories-record'

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
 * The main board, named rather than indexed out of {@link BOARDS}: callers that
 * label the mainboard must not depend on that tuple's ordering.
 */
export const MAIN_BOARD = 'Main' satisfies Board
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

/**
 * A deck fetched from a deck service, beside the card categories the service
 * states for it — Archidekt's categories, Moxfield's tags. `categories` is
 * absent for a service with no such notion (MTGGoldfish), which is not the
 * same as a deck that uses none (`[]`): only the first leaves an existing
 * categories file alone. Kept off {@link DeckData} on purpose — categories are
 * a sidecar, not part of the card lines.
 */
export type ImportedDeck = {
  deck: DeckData
  categories?: CardCategoryEntry[]
  /**
   * Category names the source uses that Ritual's name rule refused, so they
   * were left out of {@link categories}. For the caller's advisories.
   */
  refusedCategories?: string[]
}
