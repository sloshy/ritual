/**
 * "Which card names does this list hold?" — the question every categories
 * prune, stale-name report and sidecar reconcile asks, answered once.
 *
 * The names are folded through {@link foldCategoryCardName}, the categories
 * sidecar's own key space, because that is the only space in which the question
 * has a stable answer: the sidecar is keyed by name, not by `&N`.
 */

import { foldCategoryCardName } from '../card/card-categories'
import { loadListEntries } from './entry-load'
import type { DeckData } from './deck'
import type { ListType } from './list-type'

/** The names a list holds, and whether the read that produced them was lossless. */
export type ListCardNames = {
  /** Every name the list holds, folded into the categories sidecar's key space. */
  names: Set<string>
  /**
   * False when the parser could not read some body line. It matters because
   * "which names does this list hold" is not symmetric with "find this one
   * line": a line the grammar refused holds a card that is still in the file,
   * so acting on an incomplete answer (pruning, or reporting an entry stale)
   * destroys or maligns assignments the list still backs.
   */
  complete: boolean
  /** The parser's warnings, so a caller can say what it could not read. */
  warnings: string[]
}

/**
 * Names folded into the categories sidecar's key space. The one place
 * {@link foldCategoryCardName} is applied to a whole list, so a caller with its
 * own names in hand never re-spells the fold.
 */
export function foldedCardNameSet(names: Iterable<string>): Set<string> {
  const folded = new Set<string>()
  for (const name of names) folded.add(foldCategoryCardName(name))
  return folded
}

/** The card names a list file holds. Reads only. */
export async function listCardNameSet(type: ListType, filePath: string): Promise<ListCardNames> {
  const loaded = await loadListEntries(type, filePath)
  const warnings = loaded.warnings ?? []
  return {
    names: foldedCardNameSet(loaded.entries.map((entry) => entry.name)),
    complete: warnings.length === 0,
    warnings,
  }
}

/**
 * The card names an in-memory deck holds, across every section. Always complete:
 * a parsed deck model has no unread lines left in it.
 */
export function deckCardNameSet(deck: DeckData): Set<string> {
  return foldedCardNameSet(
    deck.sections.flatMap((section) => section.cards.map((card) => card.name)),
  )
}
