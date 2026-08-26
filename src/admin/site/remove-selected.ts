import type { SelectedCard } from '../../site/useCardSelection'
import type { PrintingTuple } from '../../changes/change-event'
import type { NamedListRef } from '../../site/combined-list'
import { promptForPrinting } from '../../site/printing-prompt'
import { t } from '../../i18n/t'
import type {
  RemoveCommitItem,
  RemoveCommitResponse,
  SelectedMoveItem,
  SelectedMoveResponse,
} from '../api/move'
import type { ApiErrorResponse } from '../api/save-helpers'

/** Destination + resolved printing shared by every per-copy {@link SelectedMoveItem} of one card. */
type MoveDestination = Pick<
  SelectedMoveItem,
  'toType' | 'toSlug' | 'set' | 'collectorNumber' | 'finish' | 'condition'
>

/** Full response from POST /api/remove/commit. */
export type RemoveCommitResult = RemoveCommitResponse | ApiErrorResponse

/** Full response from POST /api/move/selected. */
export type SelectedMoveResult = SelectedMoveResponse | ApiErrorResponse

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
export async function removeSelectedAdmin(cards: SelectedCard[]): Promise<RemoveCommitResult> {
  const resp = await fetch('/api/remove/commit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removes: selectionToRemoveItems(cards) }),
  })
  return (await resp.json()) as RemoveCommitResult
}

/**
 * Expand a multi-select into per-copy move items targeting `dest`, prompting for a
 * printing on each name-only card bound for a collection (which requires one). A
 * card already on the destination list, lacking a `sourceSlug`, or whose required
 * printing prompt is skipped is dropped. Returns null if every card was dropped.
 */
async function selectionToMoveItems(
  cards: SelectedCard[],
  dest: NamedListRef,
): Promise<SelectedMoveItem[]> {
  const items: SelectedMoveItem[] = []
  for (const c of cards) {
    if (!c.sourceSlug) continue
    if (c.sourceKind === dest.type && c.sourceSlug === dest.slug) continue

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

    const base: MoveDestination = { toType: dest.type, toSlug: dest.slug, ...printing }
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
  dest: NamedListRef,
): Promise<SelectedMoveResult> {
  const moves = await selectionToMoveItems(cards, dest)
  if (moves.length === 0) {
    return {
      success: true,
      moved: 0,
      requested: 0,
      skipped: 0,
      droppedNotes: [],
      warnings: [],
      message: t('admin.move.nothingToMove'),
    }
  }
  const resp = await fetch('/api/move/selected', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves }),
  })
  return (await resp.json()) as SelectedMoveResult
}
