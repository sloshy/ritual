import type { Finish } from '../types'
import type { CardLabel } from '../card-labels'
import type { CardLanguage } from '../card-language'
import type { ListRef } from '../change-event'
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
  /** Set the language on every selected card (`en` clears the line's token). */
  setLanguage: (cards: SelectedCard[], language: CardLanguage) => void
  changePrinting: (cards: SelectedCard[]) => void
  setCommander?: (cards: SelectedCard[]) => void
  /**
   * Present where the list type carries labels and its editor wires them —
   * collections take the whole vocabulary, decks `proxy` alone, wanted lists
   * none. The menu picks the offered choices from the selection's list type.
   */
  setLabel?: (cards: SelectedCard[], labels: CardLabel[]) => void
  moveToSection: (cards: SelectedCard[], section: string) => void
  promptNewSection: (cards: SelectedCard[]) => void
  sections: () => string[]
  moveToList: (cards: SelectedCard[], dest: ListRef) => void
  moveTargets: () => ListRef[]
}

/**
 * Adapt a controller's bulk-edit bundle into the {@link SelectionEditActions} the
 * selection menu renders. Each action snapshots the live selection before applying
 * (so an async/queued flow like change-printing keeps its targets) and then clears
 * it. Shared by the deck/collection/wanted pages so their menus behave identically.
 *
 * Every action is always built; the menu itself decides which to show — e.g. it
 * only surfaces "Remove a copy" when the selection holds a multi-copy group.
 */
export function buildSelectionEditActions(
  bulk: BulkEditBundle,
  selection: CardSelectionControl,
): SelectionEditActions {
  const apply = (fn: (cards: SelectedCard[]) => void) => () => {
    fn(selection.selected())
    selection.clear()
  }
  const setLabel = bulk.setLabel
  return {
    addCopy: apply(bulk.addCopy),
    removeCopy: apply(bulk.removeCopy),
    removeAll: apply(bulk.removeAll),
    setFoil: apply((cards) => bulk.setFinish(cards, 'foil')),
    setNonfoil: apply((cards) => bulk.setFinish(cards, 'nonfoil')),
    setLanguage: (language) => {
      bulk.setLanguage(selection.selected(), language)
      selection.clear()
    },
    changePrinting: apply(bulk.changePrinting),
    setCommander: bulk.setCommander ? apply(bulk.setCommander) : undefined,
    setLabel: setLabel
      ? (labels) => {
          setLabel(selection.selected(), labels)
          selection.clear()
        }
      : undefined,
    moveToSection: (section) => {
      bulk.moveToSection(selection.selected(), section)
      selection.clear()
    },
    promptNewSection: apply(bulk.promptNewSection),
    sections: bulk.sections,
    moveToList: (dest) => {
      bulk.moveToList(selection.selected(), dest)
      selection.clear()
    },
    moveTargets: bulk.moveTargets,
  }
}
