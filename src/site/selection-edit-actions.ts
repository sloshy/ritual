import type { Finish } from '../types'
import type { SelectionEditActions } from './SelectionMenu'
import type { CardSelectionControl, SelectedCard } from './useCardSelection'

/**
 * The subset of a controller's bulk-edit bundle the selection menu drives. Both
 * {@link import('../editor/DeckEditController').DeckBulkEdit} and the flat-list
 * {@link import('../editor/flat-list-controller').FlatBulkEdit} satisfy it;
 * `setCommander` is present only for decks.
 */
export type BulkEditBundle = {
  addCopy: (cards: SelectedCard[]) => void
  removeCopy: (cards: SelectedCard[]) => void
  removeAll: (cards: SelectedCard[]) => void
  setFinish: (cards: SelectedCard[], finish: Finish) => void
  changePrinting: (cards: SelectedCard[]) => void
  setCommander?: (cards: SelectedCard[]) => void
  moveToSection: (cards: SelectedCard[], section: string) => void
  promptNewSection: (cards: SelectedCard[]) => void
  sections: () => string[]
}

/**
 * Adapt a controller's bulk-edit bundle into the {@link SelectionEditActions} the
 * selection menu renders. Each action snapshots the live selection before applying
 * (so an async/queued flow like change-printing keeps its targets) and then clears
 * it. Shared by the deck/collection/wanted pages so their menus behave identically.
 */
export function buildSelectionEditActions(
  bulk: BulkEditBundle,
  selection: CardSelectionControl,
): SelectionEditActions {
  const apply = (fn: (cards: SelectedCard[]) => void) => () => {
    fn(selection.selected())
    selection.clear()
  }
  return {
    addCopy: apply(bulk.addCopy),
    removeCopy: apply(bulk.removeCopy),
    removeAll: apply(bulk.removeAll),
    setFoil: apply((cards) => bulk.setFinish(cards, 'foil')),
    setNonfoil: apply((cards) => bulk.setFinish(cards, 'nonfoil')),
    changePrinting: apply(bulk.changePrinting),
    setCommander: bulk.setCommander ? apply(bulk.setCommander) : undefined,
    moveToSection: (section) => {
      bulk.moveToSection(selection.selected(), section)
      selection.clear()
    },
    promptNewSection: apply(bulk.promptNewSection),
    sections: bulk.sections,
  }
}
