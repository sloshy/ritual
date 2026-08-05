import type { Component } from 'solid-js'
import { For, Show, createMemo } from 'solid-js'
import { AdaptiveMenu } from '../ui/AdaptiveMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import { usePointerCoarse } from '../ui/useMediaQuery'
import type { ListRef } from '../change-event'
import type { NamedListRef } from './combined-list'
import type { PriceCurrency } from '../price-currency'
import type { CardSelectionControl } from './useCardSelection'
import { useSelectionCopy } from './useSelectionCopy'
import { addSelectionToTrade } from './useSelectionTrade'
import { openSelectionView } from './SelectionModal'
import { promptListMove, promptSectionMove } from './move-prompt'
import { promptCardLabels } from './label-prompt'
import type { CardLabel } from '../card-labels'
import { BUYER_DISPLAY_NAMES } from '../buylist'
import { cartBuyer } from './sell-mode'

const PANEL_WIDTH = 220

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
  setNonfoil: () => void
  changePrinting: () => void
  /** Present for decks only. */
  setCommander?: () => void
  /** Present for collections only — set/clear the label override on the selection. */
  setLabel?: (labels: CardLabel[]) => void
  moveToSection: (section: string) => void
  promptNewSection: () => void
  /** Current section names, for the move submenu. */
  sections: () => string[]
  /** Move every selected card out of this list into another list. */
  moveToList: (dest: ListRef) => void
  /** The other lists the selection can be moved to, for the move-to-list submenu. */
  moveTargets: () => ListRef[]
}

export interface SelectionMenuProps {
  selection: CardSelectionControl
  currency: PriceCurrency
  /** Show the "Add to Trade" action. Off where the trade page is unreachable (admin site). */
  enableTrade?: boolean
  useScryfallImgUrls?: boolean
  /** Button label prefix, e.g. "Selected" (toolbar) or "All Selected" (navbar). */
  label?: string
  /** Label for the clear action, e.g. "Clear selection" (page) or "Clear all selections" (navbar). */
  clearLabel?: string
  /** Extra class for the trigger button (navbar styling). */
  buttonClass?: string
  /** Show the "View all selections" item that opens the full selection modal (navbar only). */
  showViewAll?: boolean
  /** When set (edit mode), show bulk edit actions over the selection. */
  editActions?: SelectionEditActions
  /**
   * On touch devices, present the selection as a fixed bottom action bar (count +
   * Actions + clear) instead of a toolbar dropdown button. Passed by the list
   * pages; off for the cross-list navbar menu. Suppressed in edit mode, where the
   * editor's own bottom dock occupies that edge.
   */
  dockOnTouch?: boolean
  /**
   * When set, show a "Remove all selected" action. Used by the cross-list navbar
   * menu to delete every selected card from its list; passed only while a list is
   * open in edit mode. The handler owns confirmation and clearing the selection.
   */
  onRemoveAll?: () => void
  /**
   * When set (with {@link moveAllTargets}), show a cross-list "Move all to list"
   * group. Used by the navbar menu to move every selected card from its own list
   * into the chosen destination; passed only while a list is open in edit mode.
   */
  onMoveAll?: (dest: NamedListRef) => void
  /** Destination lists for the cross-list "Move all to list" group (slug-bearing, so senders can address by slug). */
  moveAllTargets?: () => NamedListRef[]
}

/**
 * Bulk actions over the current selection. Appears once one or more cards are
 * selected, as a "Selected (N)" dropdown button — or, on touch devices when the
 * owning page opts in via `dockOnTouch`, as a fixed bottom action bar. Opens a
 * menu (anchored popover on desktop, bottom sheet on touch) of bulk actions:
 * copy as text/CSV, add to trade, and the edit-mode bundle. Used both per-list
 * (the toolbar, scoped to the current list) and cross-list (the navbar).
 */
export const SelectionMenu: Component<SelectionMenuProps> = (props) => {
  const toggle = useAnchoredToggle()
  const coarse = usePointerCoarse()

  // The fixed bottom bar replaces the dropdown trigger on touch, except in edit
  // mode where the editor's action dock already owns the bottom edge.
  const docked = () => Boolean(props.dockOnTouch) && coarse() && !props.editActions

  const surface = () => (
    <AdaptiveMenu
      toggle={toggle}
      width={PANEL_WIDTH}
      panelClass="selection-menu-panel"
      title={`${props.label ?? 'Selected'} (${props.selection.count()})`}
      role="menu"
      aria-label="Selection actions"
    >
      <SelectionMenuItems {...props} onClose={toggle.close} />
    </AdaptiveMenu>
  )

  return (
    <Show when={props.selection.count() > 0}>
      <Show
        when={docked()}
        fallback={
          <div class="selection-menu">
            <button
              type="button"
              ref={toggle.setButtonRef}
              class={`toolbar-toggle active ${props.buttonClass ?? 'selection-menu-btn'}`}
              aria-expanded={toggle.open()}
              aria-haspopup="true"
              onClick={toggle.toggleOpen}
            >
              {props.label ?? 'Selected'} ({props.selection.count()})
              <span aria-hidden="true">{toggle.open() ? '▴' : '▾'}</span>
            </button>
            {surface()}
          </div>
        }
      >
        <div class="selection-dock">
          <span class="selection-dock-count">{props.selection.count()} selected</span>
          <button
            type="button"
            ref={toggle.setButtonRef}
            class="btn btn-primary selection-dock-actions"
            aria-expanded={toggle.open()}
            aria-haspopup="true"
            onClick={toggle.toggleOpen}
          >
            Actions
          </button>
          <button
            type="button"
            class="selection-dock-clear"
            aria-label={props.clearLabel ?? 'Clear selection'}
            title={props.clearLabel ?? 'Clear selection'}
            onClick={() => props.selection.clear()}
          >
            ✕
          </button>
          {surface()}
        </div>
      </Show>
    </Show>
  )
}

type SelectionMenuItemsProps = SelectionMenuProps & {
  onClose: () => void
}

const SelectionMenuItems: Component<SelectionMenuItemsProps> = (props) => {
  const copy = useSelectionCopy(() => props.selection.selected())
  // "Remove a copy" (decrement) is only meaningful when at least one selected tile
  // represents more than one copy; for single-copy tiles it duplicates "Remove from
  // list". Reactive to the live selection so it appears/disappears as it changes.
  const canRemoveCopy = createMemo(() => props.selection.selected().some((c) => c.groupSize > 1))

  const viewAll = () => {
    openSelectionView()
    props.onClose()
  }

  // Run a bulk edit action then dismiss the menu. The action snapshots and clears
  // the selection itself, so closing here just tidies the dropdown.
  const runEdit = (action: () => void) => {
    action()
    props.onClose()
  }

  const addToTrade = async () => {
    // Snapshot before the (possibly async, picker-driven) add so clearing the
    // selection afterward doesn't race the in-flight prompts.
    const cards = props.selection.selected()
    props.onClose()
    await addSelectionToTrade(cards, props.currency, props.useScryfallImgUrls ?? false)
    props.selection.clear()
  }

  return (
    <>
      <Show when={props.showViewAll}>
        <button type="button" role="menuitem" class="selection-menu-item" onClick={viewAll}>
          View all selections…
        </button>
        <div class="selection-menu-sep" />
      </Show>
      <Show when={props.editActions}>
        {(actions) => (
          <>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().addCopy)}
            >
              Add a copy
            </button>
            <Show when={canRemoveCopy()}>
              <button
                type="button"
                role="menuitem"
                class="selection-menu-item"
                onClick={() => runEdit(actions().removeCopy)}
              >
                Remove a copy
              </button>
            </Show>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().removeAll)}
            >
              Remove from list
            </button>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().setFoil)}
            >
              Set as Foil
            </button>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().setNonfoil)}
            >
              Set as Nonfoil
            </button>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().changePrinting)}
            >
              Change Printing…
            </button>
            <Show when={actions().setCommander}>
              {(setCommander) => (
                <button
                  type="button"
                  role="menuitem"
                  class="selection-menu-item"
                  onClick={() => runEdit(setCommander())}
                >
                  Set as Commander
                </button>
              )}
            </Show>
            <Show when={actions().setLabel}>
              {(setLabel) => (
                <button
                  type="button"
                  role="menuitem"
                  class="selection-menu-item"
                  onClick={() => {
                    // Capture before closing: the close may unmount this <Show>,
                    // and the picker's callback runs after that.
                    const apply = setLabel()
                    props.onClose()
                    promptCardLabels((labels) => apply(labels))
                  }}
                >
                  Set Label…
                </button>
              )}
            </Show>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => {
                props.onClose()
                promptSectionMove(
                  actions().sections(),
                  (section) => actions().moveToSection(section),
                  actions().promptNewSection,
                )
              }}
            >
              Move to section…
            </button>
            <Show when={actions().moveTargets().length > 0}>
              <button
                type="button"
                role="menuitem"
                class="selection-menu-item"
                onClick={() => {
                  props.onClose()
                  promptListMove(actions().moveTargets(), (dest) => actions().moveToList(dest))
                }}
              >
                Move to list…
              </button>
            </Show>
            <div class="selection-menu-sep" />
          </>
        )}
      </Show>
      <button
        type="button"
        role="menuitem"
        class="selection-menu-item"
        onClick={() => void copy.copyText()}
      >
        Copy as Text
      </button>
      <button
        type="button"
        role="menuitem"
        class="selection-menu-item"
        onClick={() => void copy.copyCsv()}
      >
        Copy as CSV
      </button>
      <Show when={cartBuyer()}>
        {(buyer) => (
          <button
            type="button"
            role="menuitem"
            class="selection-menu-item"
            onClick={() => void copy.copyCart()}
          >
            Copy {BUYER_DISPLAY_NAMES[buyer()]} cart CSV
          </button>
        )}
      </Show>
      <Show when={copy.cartWarnings().length > 0}>
        <For each={copy.cartWarnings()}>
          {(warning) => <p class="selection-menu-warning">{warning}</p>}
        </For>
      </Show>
      <Show when={props.enableTrade}>
        <button
          type="button"
          role="menuitem"
          class="selection-menu-item"
          onClick={() => void addToTrade()}
        >
          Add to Trade
        </button>
      </Show>
      <div class="selection-menu-sep" />
      <Show when={props.onMoveAll && (props.moveAllTargets?.().length ?? 0) > 0}>
        <button
          type="button"
          role="menuitem"
          class="selection-menu-item"
          onClick={() => {
            props.onClose()
            promptListMove(props.moveAllTargets?.() ?? [], (dest) => props.onMoveAll!(dest))
          }}
        >
          Move all to list…
        </button>
      </Show>
      <Show when={props.onRemoveAll}>
        {(onRemoveAll) => (
          <button
            type="button"
            role="menuitem"
            class="selection-menu-item selection-menu-item--danger"
            onClick={() => {
              onRemoveAll()()
              props.onClose()
            }}
          >
            Remove all selected
          </button>
        )}
      </Show>
      <button
        type="button"
        role="menuitem"
        class="selection-menu-item"
        onClick={() => {
          props.selection.clear()
          props.onClose()
        }}
      >
        {props.clearLabel ?? 'Clear selection'}
      </button>
      <Show when={copy.status()}>
        <div class="selection-menu-status" aria-live="polite">
          {copy.status()}
        </div>
      </Show>
    </>
  )
}
