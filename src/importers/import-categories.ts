/**
 * @fileoverview Card categories a deck service states, as a URL import reads
 * them: Moxfield's per-card tags (`authorTags`) mapped onto Ritual categories,
 * and the one warning for names Ritual cannot store. Archidekt's side, which
 * must first tell boards from roles, is `./archidekt-categories.ts`.
 */

import {
  foldCardCategory,
  foldCategoryCardName,
  parseCardCategory,
  type CardCategory,
} from '../card/card-categories'
import type { CardCategoryEntry } from '../list/card-categories-record'
import type { DeckSection } from '../list/deck'
import { t } from '../i18n/t'
import { getLogger } from '../util/logger'

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
  const seenNames = new Set<string>()
  for (const section of sections) {
    for (const card of section.cards) {
      const key = foldCategoryCardName(card.name)
      if (seenNames.has(key)) continue
      seenNames.add(key)
      const categories: CardCategory[] = []
      const held = new Set<string>()
      for (const tag of tagsByName.get(key) ?? []) {
        if (typeof tag !== 'string') continue
        const parsed = parseCardCategory(tag)
        if (!parsed.ok) {
          if (!refused.includes(tag)) refused.push(tag)
          continue
        }
        const fold = foldCardCategory(parsed.category)
        if (held.has(fold)) continue
        held.add(fold)
        categories.push(parsed.category)
      }
      if (categories.length > 0) cards.push({ name: card.name, categories })
    }
  }
  return { cards, refused }
}

/** Warn about category names an import skipped because Ritual cannot store them. */
export function warnRefusedCategories(refused: readonly string[]): void {
  if (refused.length === 0) return
  getLogger().warn(
    t('cli.import.categoriesRefused', {
      count: refused.length,
      names: refused.map((name) => JSON.stringify(name)).join(', '),
    }),
  )
}
