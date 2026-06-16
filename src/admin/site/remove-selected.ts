import type { SelectedCard } from '../../site/useCardSelection'
import type { RemoveCommitItem } from '../api/move'

/** Response shape from POST /api/remove/commit. */
export type RemoveCommitResponse =
  | { success: true; removed: number; requested: number; skipped: number; message: string }
  | { success: false; message: string }

/**
 * Expand a multi-select into per-copy remove items for the cross-list endpoint.
 * Deck copies are keyed by `copyIndex` (0..groupSize-1) sharing one cardId, while
 * collection/wanted entries are one item per cardId. Cards lacking a `sourceSlug`
 * (e.g. selected before slugs were threaded) cannot be targeted and are dropped.
 */
export function selectionToRemoveItems(cards: SelectedCard[]): RemoveCommitItem[] {
  const items: RemoveCommitItem[] = []
  for (const c of cards) {
    if (!c.sourceSlug) continue
    if (c.sourceKind === 'deck') {
      const cardId = c.cardIds[0]
      for (let copyIndex = 0; copyIndex < c.groupSize; copyIndex++) {
        items.push({ listType: 'deck', listSlug: c.sourceSlug, name: c.name, cardId, copyIndex })
      }
    } else {
      for (const cardId of c.cardIds) {
        items.push({
          listType: c.sourceKind,
          listSlug: c.sourceSlug,
          name: c.name,
          cardId,
          copyIndex: 0,
        })
      }
    }
  }
  return items
}

/** Remove every selected card from its list file via the atomic admin endpoint. */
export async function removeSelectedAdmin(cards: SelectedCard[]): Promise<RemoveCommitResponse> {
  const resp = await fetch('/api/remove/commit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removes: selectionToRemoveItems(cards) }),
  })
  return (await resp.json()) as RemoveCommitResponse
}
