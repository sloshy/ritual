import type { Accessor, Component } from 'solid-js'
import { Show } from 'solid-js'
import { useAnchoredMenu } from '../ui/useAnchoredMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import type { PriceCurrency } from '../price-currency'
import type { CardSelectionControl } from './useCardSelection'
import { useSelectionCopy } from './useSelectionCopy'
import { addSelectionToTrade } from './useSelectionTrade'
import { openSelectionView } from './SelectionModal'

const PANEL_WIDTH = 220

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
