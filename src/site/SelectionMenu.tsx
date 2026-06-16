import type { Accessor, Component } from 'solid-js'
import { For, Show } from 'solid-js'
import { useAnchoredMenu } from '../ui/useAnchoredMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import type { PriceCurrency } from '../price-currency'
import type { CardSelectionControl } from './useCardSelection'
import { useSelectionCopy } from './useSelectionCopy'
import { addSelectionToTrade } from './useSelectionTrade'
import { openSelectionView } from './SelectionModal'

const PANEL_WIDTH = 220

/**
 * Bulk edit operations exposed by the selection menu when a list is open in edit
 * mode. Mirrors the per-card `⋯` context menu: quantity steppers, full removal,
 * foil toggling, change printing, commander (decks only), and section moves. The
 * owning page wires each to its editor's bulk-edit bundle over the live selection.
 */
export interface SelectionEditActions {
  addCopy: () => void
  removeCopy: () => void
  removeAll: () => void
  setFoil: () => void
  setNonfoil: () => void
  changePrinting: () => void
  /** Present for decks only. */
  setCommander?: () => void
  moveToSection: (section: string) => void
  promptNewSection: () => void
  /** Current section names, for the move submenu. */
  sections: () => string[]
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
   * When set, show a "Remove all selected" action. Used by the cross-list navbar
   * menu to delete every selected card from its list. The handler owns confirmation
   * and clearing the selection.
   */
  onRemoveAll?: () => void
}

/**
 * A "Selected (N)" dropdown button: appears once one or more cards are selected,
 * and opens a menu of bulk actions over the selection — copy as text, copy as
 * CSV, and (on the public site) add to the active trade. Used both per-list (the
 * toolbar, scoped to the current list) and cross-list (the navbar, all lists).
 */
export const SelectionMenu: Component<SelectionMenuProps> = (props) => {
  const toggle = useAnchoredToggle()

  return (
    <Show when={props.selection.count() > 0}>
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
        <Show when={toggle.open() ? toggle.anchorRect() : null}>
          {(rect) => (
            <SelectionPanel
              anchorRect={rect}
              anchorEl={toggle.buttonEl}
              onClose={toggle.close}
              {...props}
            />
          )}
        </Show>
      </div>
    </Show>
  )
}

type SelectionPanelAnchor = {
  anchorRect: Accessor<DOMRect>
  onClose: () => void
  /** The toggle button, excluded from outside-click dismissal so it can close the panel itself. */
  anchorEl: () => HTMLElement | undefined
}

type SelectionPanelProps = SelectionMenuProps & SelectionPanelAnchor

const SelectionPanel: Component<SelectionPanelProps> = (props) => {
  const menu = useAnchoredMenu({
    anchorRect: props.anchorRect,
    width: PANEL_WIDTH,
    onClose: props.onClose,
    excludeEl: props.anchorEl,
  })
  const copy = useSelectionCopy(() => props.selection.selected())

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
    <div
      ref={menu.setMenuRef}
      class="selection-menu-panel"
      style={menu.style()}
      role="menu"
      aria-label="Selection actions"
    >
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
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().removeCopy)}
            >
              Remove a copy
            </button>
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
            <div class="selection-menu-label">Move to section</div>
            <For each={actions().sections()}>
              {(section) => (
                <button
                  type="button"
                  role="menuitem"
                  class="selection-menu-item selection-menu-item--indented"
                  onClick={() => runEdit(() => actions().moveToSection(section))}
                >
                  {section}
                </button>
              )}
            </For>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item selection-menu-item--indented"
              onClick={() => runEdit(actions().promptNewSection)}
            >
              New section…
            </button>
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
    </div>
  )
}
