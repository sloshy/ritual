import type { SelectedCard } from '../../site/useCardSelection'
import type { ListRef, PrintingTuple } from '../../change-event'
import { promptForPrinting } from '../../site/printing-prompt'
import type { RemoveCommitItem, SelectedMoveItem } from '../api/move'

/** Destination + resolved printing shared by every per-copy {@link SelectedMoveItem} of one card. */
type MoveDestination = Pick<
  SelectedMoveItem,
  'toType' | 'toName' | 'set' | 'collectorNumber' | 'finish' | 'condition'
>

/** Response shape from POST /api/remove/commit. */
export type RemoveCommitResponse =
  | { success: true; removed: number; requested: number; skipped: number; message: string }
  | { success: false; message: string }

/** Response shape from POST /api/move/selected. */
export type SelectedMoveResponse =
  | { success: true; moved: number; requested: number; skipped: number; message: string }
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

/**
 * Expand a multi-select into per-copy move items targeting `dest`, prompting for a
 * printing on each name-only card bound for a collection (which requires one). A
 * card already on the destination list, lacking a `sourceSlug`, or whose required
 * printing prompt is skipped is dropped. Returns null if every card was dropped.
 */
async function selectionToMoveItems(
  cards: SelectedCard[],
  dest: ListRef,
): Promise<SelectedMoveItem[]> {
  const items: SelectedMoveItem[] = []
  for (const c of cards) {
    if (!c.sourceSlug) continue
    if (c.sourceKind === dest.type && c.sourceName === dest.name) continue

    let printing: PrintingTuple = {}
    if (dest.type === 'collection' && !(c.set && c.collectorNumber)) {
      const picked = await promptForPrinting(c.name, c.printings ?? [])
      if (!picked) continue
      printing = {
        set: picked.printing.set.toLowerCase(),
        collectorNumber: picked.printing.collector_number,
        finish: picked.finish,
        condition: c.condition,
      }
    }

    const base: MoveDestination = { toType: dest.type, toName: dest.name, ...printing }
    if (c.sourceKind === 'deck') {
      const cardId = c.cardIds[0]
      for (let copyIndex = 0; copyIndex < c.groupSize; copyIndex++) {
        items.push({
          listType: 'deck',
          listSlug: c.sourceSlug,
          name: c.name,
          cardId,
          copyIndex,
          ...base,
        })
      }
    } else {
      for (const cardId of c.cardIds) {
        items.push({
          listType: c.sourceKind,
          listSlug: c.sourceSlug,
          name: c.name,
          cardId,
          copyIndex: 0,
          ...base,
        })
      }
    }
  }
  return items
}

/** Move every selected card from its own list into `dest` via the atomic admin endpoint. */
export async function moveSelectedAdmin(
  cards: SelectedCard[],
  dest: ListRef,
): Promise<SelectedMoveResponse> {
  const moves = await selectionToMoveItems(cards, dest)
  if (moves.length === 0) {
    return { success: true, moved: 0, requested: 0, skipped: 0, message: 'No cards to move.' }
  }
  const resp = await fetch('/api/move/selected', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves }),
  })
  return (await resp.json()) as SelectedMoveResponse
}
