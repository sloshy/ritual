import type { CardContextInfo } from '../site/card-context'
import type { SelectedCard } from '../site/useCardSelection'

/**
 * Adapt a {@link SelectedCard} (from the multi-select store) into the
 * {@link CardContextInfo} the editor's target-explicit handlers expect. Used by the
 * bulk edit bundles so the foil/section/change-printing actions can act on each
 * selected tile. Set codes stay lowercase — `SelectedCard.set` already is.
 */
export function contextInfoFromSelected(card: SelectedCard): CardContextInfo {
  return {
    cardName: card.name,
    card: card.scryfallCard,
    cardIds: card.cardIds,
    quantity: card.quantity,
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
  }
}
