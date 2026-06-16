import { type ChangeEvent, createRemoveChange } from '../change-event'
import { activeEditSession } from './editor/active-edit-session'
import { appendChangesToSession } from './editor/edit-session-storage'
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
 * other list's removals are merged into its saved browser session, surfacing via
 * the restore prompt when that list is next opened in edit mode. Cards lacking a
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
    appendChangesToSession(group.kind, group.slug, group.name, events)
  }
}
