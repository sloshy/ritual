/**
 * @fileoverview Card categories a deck service states, as a URL import reads
 * them: Moxfield's per-card tags (`authorTags`) mapped onto Ritual categories,
 * and the advisories an import reports about them. Archidekt's side, which
 * must first tell boards from roles, is `./archidekt-categories.ts`.
 */

import { foldCategoryCardName, parseCardCategoryNames } from '../card/card-categories'
import { nestSync, syncList, syncMessage, type SyncMessage } from '../sync/message'
import { deckCardNames } from '../list/card-names'
import type { CardCategoryEntry } from '../list/card-categories-record'
import type { DeckSection } from '../list/deck'

/** A deck's categories as an import reads them, and the names Ritual refused. */
export type ImportedCategories = {
  /** One entry per card name with at least one category, in deck order. */
  cards: CardCategoryEntry[]
  /** Names Ritual's category rule refused, deduplicated, in first-seen order. */
  refused: string[]
}

/**
 * Moxfield's tags for the cards a deck holds. `authorTags` maps a card name to
 * its tags in the author's order — what Ritual calls the card's categories,
 * the first being primary. Tags for a card the deck does not hold are dropped.
 */
export function moxfieldDeckCategories(
  authorTags: Readonly<Record<string, readonly string[]>> | null | undefined,
  sections: readonly DeckSection[],
): ImportedCategories {
  const tagsByName = new Map<string, readonly string[]>()
  for (const [name, tags] of Object.entries(authorTags ?? {})) {
    const key = foldCategoryCardName(name)
    if (!tagsByName.has(key) && Array.isArray(tags)) tagsByName.set(key, tags)
  }

  const cards: CardCategoryEntry[] = []
  const refused: string[] = []
  for (const name of deckCardNames({ sections })) {
    const tags = (tagsByName.get(foldCategoryCardName(name)) ?? []).filter(
      (tag): tag is string => typeof tag === 'string',
    )
    const parsed = parseCardCategoryNames(tags)
    for (const tag of parsed.refused) if (!refused.includes(tag)) refused.push(tag)
    if (parsed.categories.length > 0) cards.push({ name, categories: parsed.categories })
  }
  return { cards, refused }
}

/**
 * The advisories a deck import's categories produced: the source's category
 * names Ritual refused, and a categories file that could not be written. Not
 * loss of cards — the deck imported — so they ride the non-fatal `advisories`
 * channel every import surface already reports. Messages (English plus key),
 * like the CSV importer's category notices; each refused name is quoted as a
 * JSON string, so a control character shows as its escape.
 */
export function importCategoryAdvisories(
  refused: readonly string[] | undefined,
  categoryError: SyncMessage | undefined,
): SyncMessage[] {
  const advisories: SyncMessage[] = []
  if (refused !== undefined && refused.length > 0) {
    advisories.push(
      syncMessage('domain.import.categoriesRefused', {
        names: syncList(
          refused.map((name) => JSON.stringify(name)),
          'unit',
        ),
      }),
    )
  }
  if (categoryError !== undefined) {
    advisories.push(
      syncMessage('domain.import.categoriesNotSaved', { error: nestSync(categoryError) }),
    )
  }
  return advisories
}
