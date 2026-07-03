import {
  type ChangeEvent,
  type ListRef,
  createMoveFromChange,
  createRemoveChange,
} from '../change-event'
import { activeEditSession } from './editor/active-edit-session'
import { appendEditSession } from './editor/edit-session-memory'
import { printingForMove } from './printing-prompt'
import { groupSelectionsBySource, type SelectedCard } from './useCardSelection'

/**
 * Build the `remove` change events that delete a selected card entirely. Decks
 * collapse a multi-copy entry one copy at a time, so emit `groupSize` events
 * sharing the entry's cardId; flat lists have one entry per copy, so emit one per
 * cardId. Set codes stay lowercase (already normalized on the SelectedCard).
 */
function removeEventsFor(card: SelectedCard): ChangeEvent[] {
  const printing = {
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
  }
  if (card.sourceKind === 'deck') {
    const cardId = card.cardIds[0]
    return Array.from({ length: card.groupSize }, () =>
      createRemoveChange(card.name, { ...printing, cardId }),
    )
  }
  return card.cardIds.map((cardId) => createRemoveChange(card.name, { ...printing, cardId }))
}

/**
 * Remove every selected card from its list on the public site. The list currently
 * open in an editor is updated live (its pending changes show the removals); every
 * other list's removals are appended to its in-memory edit session, so they apply
 * when that list is next opened in edit mode this page session. Cards lacking a
 * `sourceSlug` cannot be targeted off-editor and are skipped there.
 */
export function removeAllSelectedPublic(cards: SelectedCard[]): void {
  const active = activeEditSession()
  for (const group of groupSelectionsBySource(cards)) {
    if (active && active.kind === group.kind && active.slug === group.slug) {
      active.bulkEdit.removeAll(group.cards)
      continue
    }
    if (!group.slug) continue
    const events = group.cards.flatMap(removeEventsFor)
    appendEditSession(group.kind, group.slug, group.name, events)
  }
}

/**
 * Build the `move-from` events that move one selected card out to `dest`, prompting
 * for a printing when a name-only card is bound for a collection. Mirrors
 * {@link removeEventsFor}'s per-copy decomposition. Returns null if the required
 * printing prompt is skipped.
 */
async function moveEventsFor(card: SelectedCard, dest: ListRef): Promise<ChangeEvent[] | null> {
  const printing = await printingForMove(
    card.name,
    dest,
    {
      set: card.set,
      collectorNumber: card.collectorNumber,
      finish: card.finish,
      condition: card.condition,
    },
    card.printings ?? [],
  )
  if (!printing) return null
  if (card.sourceKind === 'deck') {
    const cardId = card.cardIds[0]
    return Array.from({ length: card.groupSize }, () =>
      createMoveFromChange(card.name, { ...printing, cardId, to: dest }),
    )
  }
  return card.cardIds.map((cardId) =>
    createMoveFromChange(card.name, { ...printing, cardId, to: dest }),
  )
}

/**
 * Move every selected card from its list into `dest` on the public site. The list
 * currently open in an editor is updated live (via its bulk move, which prompts for
 * any needed printing); every other list's moves are appended to its in-memory edit
 * session so they apply when that list is next opened this page session. Cards
 * already on `dest`, or lacking a `sourceSlug` off-editor, are skipped.
 */
export async function moveAllSelectedPublic(cards: SelectedCard[], dest: ListRef): Promise<void> {
  const active = activeEditSession()
  for (const group of groupSelectionsBySource(cards)) {
    if (group.kind === dest.type && group.name === dest.name) continue
    if (active && active.kind === group.kind && active.slug === group.slug) {
      active.bulkEdit.moveToList(group.cards, dest)
      continue
    }
    if (!group.slug) continue
    for (const card of group.cards) {
      const events = await moveEventsFor(card, dest)
      if (events) appendEditSession(group.kind, group.slug, group.name, events)
    }
  }
}
