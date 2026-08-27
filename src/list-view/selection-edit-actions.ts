import type { Finish } from '../card/finish-condition'
import type { CardLabel } from '../card/card-labels'
import type { CardLanguage } from '../card/card-language'
import type { ListRef } from '../changes/change-event'
import type { CardSelectionControl, SelectedCard } from './useCardSelection'

/**
 * The subset of a controller's bulk-edit bundle the selection menu drives. Both
 * `DeckBulkEditBundle` below and the flat-list `FlatBulkEdit` (in
 * `editor/flat-list-controller`) are derived from it; `setCommander` is present
 * only for decks.
 *
 * The two controllers reach the same operations by different routes: a deck maps
 * the selection onto its single-card primitives and operates by card *name*,
 * applying copies as repeated single-step changes; a flat list holds one entry
 * per copy with its own `cardId`, so removals target the specific entries
 * resolved from the selection's `cardIds` — never by name.
 */
export type BulkEditBundle = {
  /** Add one more copy of each selected card. */
  addCopy: (cards: SelectedCard[]) => void
  /** Remove one copy of each selected card. */
  removeCopy: (cards: SelectedCard[]) => void
  /** Remove every copy of each selected card (full removal). */
  removeAll: (cards: SelectedCard[]) => void
  /** Set the finish on each selected card that supports it; others are skipped. */
  setFinish: (cards: SelectedCard[], finish: Finish) => void
  /**
   * Whether {@link setFinish} would apply the finish to *every* selected card
   * as the list stands now — both halves of the question it asks: the card's
   * printing publishes that finish, and (for foil/etched) the line pins a
   * printing at all. A {@link SelectedCard} is a snapshot taken when the tile
   * was ticked, so its printing can be stale in both directions — pinned since,
   * or unpinned again by an undo — and the answer comes from live data.
   *
   * All-or-nothing on purpose: `setFinish` skips what it cannot apply, so a
   * partially-applicable selection would look like it worked while quietly
   * leaving cards behind. The menu greys the action out instead.
   */
  canSetFinish: (cards: SelectedCard[], finish: Finish) => boolean
  /**
   * Set the language on every selected card — every copy of the entry for a
   * deck, every copy of every entry for a flat list (`en` clears the token).
   */
  setLanguage: (cards: SelectedCard[], language: CardLanguage) => void
  /** Run the change-printing flow over the selection one card at a time. */
  changePrinting: (cards: SelectedCard[]) => void
  /**
   * Open the "Swap Printings" wizard pre-checked on the selection. Present for
   * deck and collection editors — supplied by the collection layer for flat
   * lists, absent elsewhere, since a wanted list holds no physical cards to swap.
   */
  swapPrintings?: (cards: SelectedCard[]) => void
  /** Mark each selected card as a commander. Decks only. */
  setCommander?: (cards: SelectedCard[]) => void
  /**
   * Set (or clear, with `[]`) the label override on every selected card. Present
   * where the list type carries labels and its editor wires them — collections
   * take the whole vocabulary (supplied by the collection layer; absent for
   * wanted lists), decks carry `proxy` alone so the picker offers that and the
   * clear row. The menu picks the offered choices from the selection's list type.
   */
  setLabel?: (cards: SelectedCard[], labels: CardLabel[]) => void
  /** Move every selected card into an existing section. */
  moveToSection: (cards: SelectedCard[], section: string) => void
  /** Prompt for a new section name and move every selected card into it. */
  promptNewSection: (cards: SelectedCard[]) => void
  /** Current section names, for the move submenu. */
  sections: () => string[]
  /** Move every selected card out of this list into another list. */
  moveToList: (cards: SelectedCard[], dest: ListRef) => void
  /** The other lists cards can be moved to, for the move-to-list submenu. */
  moveTargets: () => ListRef[]
}

/**
 * Bulk edit operations exposed by the selection menu when a list is open in edit
 * mode. Mirrors the per-card `⋯` context menu: quantity steppers, full removal,
 * foil toggling, change printing, commander (decks only), and section moves. The
 * owning page wires each to its editor's bulk-edit bundle over the live selection.
 */
export interface SelectionEditActions {
  addCopy: () => void
  /**
   * Decrement one copy from each selected group. The menu only shows the "Remove a
   * copy" item when the selection actually contains a multi-copy group (some tile
   * with `groupSize > 1`); for single-copy tiles it would be identical to "Remove
   * from list", so it is hidden. This is selection-driven, not list-type-driven —
   * a deck holding one of a card (a common commander-deck case) does not qualify.
   */
  removeCopy: () => void
  removeAll: () => void
  setFoil: () => void
  /** {@link BulkEditBundle.canSetFinish} for `foil`, over the live selection. */
  canSetFoil: () => boolean
  setNonfoil: () => void
  /** Absent until the owning editor exposes a handler — the item hides itself then. */
  setLanguage?: (language: CardLanguage) => void
  changePrinting: () => void
  /** Open the swap wizard on the selection. Present for deck and collection editors only. */
  swapPrintings?: () => void
  /** Present for decks only. */
  setCommander?: () => void
  /** {@link BulkEditBundle.setLabel} over the selection; absent where unwired. */
  setLabel?: (labels: CardLabel[]) => void
  moveToSection: (section: string) => void
  promptNewSection: () => void
  sections: () => string[]
  moveToList: (dest: ListRef) => void
  moveTargets: () => ListRef[]
}

/** A deck's bundle: the shared set plus the actions every deck line supports. */
export type DeckBulkEditBundle = BulkEditBundle &
  Required<Pick<BulkEditBundle, 'setCommander' | 'setLabel' | 'swapPrintings'>>

/**
 * A wanted list holds no physical cards: no commander, no labels, no swap.
 *
 * The three are re-declared as `never` rather than merely omitted. `Omit` alone
 * leaves them *unconstrained*, so a flat-list bundle that carries them (the
 * collection layer's) assigns straight through and the actions reappear on a
 * wanted list's selection menu. Declared absent, dropping them is a decision the
 * caller has to write down.
 */
export type WantedBulkEditBundle = Omit<
  BulkEditBundle,
  'setCommander' | 'setLabel' | 'swapPrintings'
> & { setCommander?: never; setLabel?: never; swapPrintings?: never }

/**
 * Adapt a controller's bulk-edit bundle into the {@link SelectionEditActions} the
 * selection menu renders. Each action snapshots the live selection before applying
 * (so an async flow like change-printing keeps its targets) and then clears it.
 * Every action is always built; the menu itself decides which to show.
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
    canSetFoil: () => bulk.canSetFinish(selection.selected(), 'foil'),
    setNonfoil: apply((cards) => bulk.setFinish(cards, 'nonfoil')),
    setLanguage: (language) => {
      bulk.setLanguage(selection.selected(), language)
      selection.clear()
    },
    changePrinting: apply(bulk.changePrinting),
    swapPrintings: bulk.swapPrintings ? apply(bulk.swapPrintings) : undefined,
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
