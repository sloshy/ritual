/**
 * @fileoverview The categories half of a deck sync (`--sync-categories`): what a
 * pull changes in the local `<deck>.categories.json`, and what a push reads out
 * of it. The Archidekt side of the mapping — which of a relation's categories
 * are boards and which are roles — is `src/importers/archidekt-categories.ts`.
 */

import {
  CARD_CATEGORY_SHAPE_CLAUSE,
  foldCategoryCardName,
  sameCardCategories,
  type CardCategory,
} from '../card/card-categories'
import { createSetCategoriesChange, type SetCategoriesChange } from '../changes/change-event'
import type { ArchidektDeckCategories } from '../importers/archidekt-categories'
import {
  parseArchidektDeckCategories,
  type ArchidektRawDeckResponse,
} from '../importers/archidekt-types'
import {
  cardCategoriesOf,
  loadCardCategories,
  type CardCategoriesRecord,
} from '../list/card-categories-sidecar'
import type { DeckData } from '../list/deck'
import { deckCardNames, deckCardNameSet } from '../list/card-names'
import type { LocalCategoriesOf } from './upload-plan'

/**
 * A deck's categories sidecar, or why it cannot be read. Read before a sync
 * writes anything, so a deck whose sidecar Ritual cannot parse fails whole
 * rather than syncing its cards and then refusing its categories.
 */
export async function loadDeckCategories(filePath: string): Promise<CardCategoriesRecord | string> {
  const loaded = await loadCardCategories(filePath)
  return loaded.ok ? loaded.categories : loaded.message
}

/**
 * The remote deck's role categories per card, read off the raw payload a sync
 * fetched through the same parser the URL import uses — so a legacy payload's
 * numeric category ids resolve to names here too.
 */
export function remoteDeckCategories(raw: ArchidektRawDeckResponse): ArchidektDeckCategories {
  return parseArchidektDeckCategories(raw)
}

/**
 * The `set-categories` events that make the local sidecar hold the remote
 * deck's categories for every card both the (post-pull) deck and Archidekt
 * hold — a card the remote files under no role category is cleared. A local
 * card Archidekt does not hold at all (a removal `--only additions` kept) is
 * left alone, and entries for cards the deck no longer holds are the prune's
 * business, not an event's.
 */
export function pullCategoryChanges(
  local: CardCategoriesRecord,
  remote: ArchidektDeckCategories,
  deck: DeckData,
): SetCategoriesChange[] {
  const remoteByName = new Map(
    remote.cards.map((entry) => [foldCategoryCardName(entry.name), entry.categories]),
  )
  const changes: SetCategoriesChange[] = []
  for (const name of deckCardNames(deck)) {
    if (!remote.held.has(foldCategoryCardName(name))) continue
    const next = remoteByName.get(foldCategoryCardName(name))
    if (sameCardCategories(cardCategoriesOf(local, name), next)) continue
    changes.push(createSetCategoriesChange(name, next ?? []))
  }
  return changes
}

/**
 * What a push reads for each card: its local categories when the deck holds it
 * (empty when uncategorized), `undefined` when it does not.
 */
export function localCategoriesFor(
  record: CardCategoriesRecord,
  deck: DeckData,
): LocalCategoriesOf {
  const held = deckCardNameSet(deck)
  return (cardName: string): readonly CardCategory[] | undefined =>
    held.has(foldCategoryCardName(cardName))
      ? (cardCategoriesOf(record, cardName) ?? [])
      : undefined
}

/** The log line for Archidekt category names Ritual's name rule refused. */
export function refusedCategoriesMessage(refused: readonly string[]): string {
  return `Skipped ${refused.length === 1 ? 'an Archidekt category' : `${refused.length} Archidekt categories`} Ritual cannot store (${CARD_CATEGORY_SHAPE_CLAUSE}): ${refused.map((name) => JSON.stringify(name)).join(', ')}`
}
