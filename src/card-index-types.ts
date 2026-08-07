/**
 * The cross-list physical-card index's own vocabulary.
 *
 * These live here rather than in the move endpoints because the index is the
 * general shape — `GET /api/card-index`, the MCP `find_cards` tool, and the
 * admin Move Cards page all speak it — and the move flow is one consumer of it.
 * `card-index.ts` importing them from `move.ts` inverted that dependency.
 */

import type { Condition, Finish } from './types'
import type { CardLanguage } from './card-language'
import type { ListType } from './list-type'

/**
 * One movable physical card. Mirrors the CLI's `PhysicalCard` but uses a
 * slug-based, path-free `key` so the browser can echo it back on commit without
 * ever seeing absolute server paths. Deck entries with quantity > 1 expand to one
 * card per copy (distinguished by `copyIndex`).
 */
export type MovePhysicalCard = {
  key: string
  listType: ListType
  listSlug: string
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The line's language token, when present. Absent means `en`. */
  language?: CardLanguage
  note?: string
  cardId?: number
  copyIndex?: number
}

/**
 * Stable, path-free key for a physical card within a move session. Reconstructed
 * identically on the server at commit time (from the unchanged files) so the
 * browser only ever round-trips the opaque key. Matches the shape of the CLI's
 * `PhysicalCard.key` but keyed on `type:slug` rather than the absolute file path.
 */
export function moveCardKey(
  type: ListType,
  slug: string,
  cardId: number | undefined,
  name: string,
  copyIndex: number | undefined,
): string {
  return `${type}:${slug}:${cardId ?? name}:${copyIndex ?? 0}`
}

/**
 * The minimum a physical card must expose for {@link indexPhysicalCards} to key
 * it. Structural rather than an import of the CLI's `PhysicalCard`, so this
 * module stays free of the move engine.
 */
export type KeyablePhysicalCard = {
  key: string
  name: string
  cardId?: number
  copyIndex?: number
  listEntry: { filePath: string; ref: { type: ListType } }
}

/**
 * Rebuild the client-facing → internal key map for a batch of physical cards.
 *
 * The producer (`GET /api/card-index`) and every consumer (move commit, remove
 * commit, selected move) must derive the client key by the *same* rule, because
 * a key the consumer builds differently simply fails to resolve and the card is
 * silently reported as skipped. One function makes that impossible rather than
 * merely unlikely.
 */
export function indexPhysicalCards(
  cards: readonly KeyablePhysicalCard[],
  slugByPath: ReadonlyMap<string, string>,
): Map<string, string> {
  const byClientKey = new Map<string, string>()
  for (const card of cards) {
    const slug = slugByPath.get(card.listEntry.filePath)
    if (slug === undefined) continue
    byClientKey.set(
      moveCardKey(card.listEntry.ref.type, slug, card.cardId, card.name, card.copyIndex),
      card.key,
    )
  }
  return byClientKey
}
