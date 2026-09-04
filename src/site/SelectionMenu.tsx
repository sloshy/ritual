import type { Component } from 'solid-js'
import { For, Show, createMemo } from 'solid-js'
import { AdaptiveMenu } from '../ui/AdaptiveMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import { usePointerCoarse } from '../ui/useMediaQuery'
import type { NamedListRef } from '../list-view/combined-list'
import type { PriceCurrency } from '../pricing/price-currency'
import type { CardSelectionControl, SelectedCard } from '../list-view/useCardSelection'
import type { SelectionEditActions } from '../list-view/selection-edit-actions'
import { useSelectionCopy } from './useSelectionCopy'
import { addSelectionToTrade } from './useSelectionTrade'
import { openSelectionView } from './SelectionModal'
import { promptListMove, promptSectionMove } from '../list-view/move-prompt'
import { promptCardLabels } from '../list-view/label-prompt'
import { promptCardLanguage } from '../list-view/language-prompt'
import { supportsAnyLabels, type CardLabel } from '../card/card-labels'
import type { ListType } from '../list/list-type'
import { displayLanguage, type CardLanguage } from '../card/card-language'
import { buyerName } from '../buylist'
import { cartBuyer } from '../list-view/sell-mode'
import { useT } from '../ui/i18n'

const PANEL_WIDTH = 220

/**
 * The one language every selected card shares (folding bare lines to `en`), or
 * undefined for a mixed selection — the language picker marks it as current.
 */
function commonSelectionLanguage(cards: SelectedCard[]): CardLanguage | undefined {
  if (cards.length === 0) return undefined
  const first = displayLanguage(cards[0]?.language)
  return cards.every((c) => displayLanguage(c.language) === first) ? first : undefined
}

/**
 * The list type whose label vocabulary the picker should offer — the kind every
 * selected card shares, when that kind carries labels at all. Undefined for a
 * mixed selection: the vocabularies differ by type (a deck takes `proxy`
 * alone), so no one picker could describe the whole selection.
 */
function commonLabelListType(cards: SelectedCard[]): ListType | undefined {
  const first = cards[0]?.sourceKind
  if (first === undefined || !supportsAnyLabels(first)) return undefined
  return cards.every((c) => c.sourceKind === first) ? first : undefined
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
  const t = useT()
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
      title={`${props.label ?? t('site.selection.defaultLabel')} (${props.selection.count()})`}
      role="menu"
      aria-label={t('site.selection.actionsAria')}
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
              {props.label ?? t('site.selection.defaultLabel')} ({props.selection.count()})
              <span aria-hidden="true">{toggle.open() ? '▴' : '▾'}</span>
            </button>
            {surface()}
          </div>
        }
      >
        <div class="selection-dock">
          <span class="selection-dock-count">
            {t('site.selection.dockCount', { count: props.selection.count() })}
          </span>
          <button
            type="button"
            ref={toggle.setButtonRef}
            class="btn btn-primary selection-dock-actions"
            aria-expanded={toggle.open()}
            aria-haspopup="true"
            onClick={toggle.toggleOpen}
          >
            {t('site.selection.actions')}
          </button>
          <button
            type="button"
            class="selection-dock-clear"
            aria-label={props.clearLabel ?? t('site.selection.clear')}
            title={props.clearLabel ?? t('site.selection.clear')}
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

/** The label picker the menu can open: which vocabulary, and what to do with the pick. */
type LabelAction = { type: ListType; setLabel: (labels: CardLabel[]) => void }

const SelectionMenuItems: Component<SelectionMenuItemsProps> = (props) => {
  const t = useT()
  const copy = useSelectionCopy(() => props.selection.selected())
  // "Remove a copy" (decrement) is only meaningful when at least one selected tile
  // represents more than one copy; for single-copy tiles it duplicates "Remove from
  // list". Reactive to the live selection so it appears/disappears as it changes.
  const canRemoveCopy = createMemo(() => props.selection.selected().some((c) => c.groupSize > 1))

  /**
   * "Set as Foil" is disabled while any selected card names no printing: a
   * finish belongs to a printing, so those cards need one pinned first. The
   * nonfoil direction stays enabled — it clears a token rather than asserting a
   * finish the line cannot have.
   */
  const foilNeedsPrinting = createMemo(() => {
    const actions = props.editActions
    // Reading the live selection keeps the memo subscribed to it, so the row
    // re-evaluates as tiles are ticked as well as when the list data changes.
    props.selection.selected()
    return actions !== undefined && !actions.canSetFoil()
  })

  /**
   * The "Set Label…" action and the list type whose choices it offers, or
   * undefined when the open editor exposes no label handler or the selection
   * spans list types with different vocabularies.
   */
  const labelAction = createMemo((): LabelAction | undefined => {
    const setLabel = props.editActions?.setLabel
    if (!setLabel) return undefined
    const type = commonLabelListType(props.selection.selected())
    return type ? { type, setLabel } : undefined
  })

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
    await addSelectionToTrade(cards, {
      currency: props.currency,
      useScryfallImgUrls: props.useScryfallImgUrls ?? false,
    })
    props.selection.clear()
  }

  return (
    <>
      <Show when={props.showViewAll}>
        <button type="button" role="menuitem" class="selection-menu-item" onClick={viewAll}>
          {t('site.selection.viewAll')}
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
              {t('site.selection.addCopy')}
            </button>
            <Show when={canRemoveCopy()}>
              <button
                type="button"
                role="menuitem"
                class="selection-menu-item"
                onClick={() => runEdit(actions().removeCopy)}
              >
                {t('site.selection.removeCopy')}
              </button>
            </Show>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().removeAll)}
            >
              {t('site.selection.removeFromList')}
            </button>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => {
                if (!foilNeedsPrinting()) runEdit(actions().setFoil)
              }}
              // See CardContextMenu: `aria-disabled` keeps the row focusable and
              // its `title` visible, where a native `disabled` would hide both.
              aria-disabled={foilNeedsPrinting()}
              title={foilNeedsPrinting() ? t('ui.cardMenu.foilNeedsPrinting') : undefined}
            >
              {t('site.selection.setFoil')}
            </button>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().setNonfoil)}
            >
              {t('site.selection.setNonfoil')}
            </button>
            <Show when={actions().setLanguage}>
              {(setLanguage) => (
                <button
                  type="button"
                  role="menuitem"
                  class="selection-menu-item"
                  onClick={() => {
                    // Capture before closing: the close may unmount this <Show>,
                    // and the picker's callback runs after that. The picker marks
                    // the selection's common language, when it has one.
                    const apply = setLanguage()
                    const current = commonSelectionLanguage(props.selection.selected())
                    props.onClose()
                    promptCardLanguage(current, apply)
                  }}
                >
                  {t('site.selection.setLanguage')}
                </button>
              )}
            </Show>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().changePrinting)}
            >
              {t('site.selection.changePrinting')}
            </button>
            <Show when={actions().swapPrintings}>
              {(swapPrintings) => (
                <button
                  type="button"
                  role="menuitem"
                  class="selection-menu-item"
                  onClick={() => runEdit(swapPrintings())}
                >
                  {t('site.selection.swapPrintings')}
                </button>
              )}
            </Show>
            <Show when={actions().setCommander}>
              {(setCommander) => (
                <button
                  type="button"
                  role="menuitem"
                  class="selection-menu-item"
                  onClick={() => runEdit(setCommander())}
                >
                  {t('site.selection.setCommander')}
                </button>
              )}
            </Show>
            <Show when={labelAction()}>
              {(action) => (
                <button
                  type="button"
                  role="menuitem"
                  class="selection-menu-item"
                  onClick={() => {
                    // Capture before closing: the close may unmount this <Show>,
                    // and the picker's callback runs after that.
                    const { type, setLabel } = action()
                    props.onClose()
                    promptCardLabels(type, (labels) => setLabel(labels))
                  }}
                >
                  {t('site.selection.setLabel')}
                </button>
              )}
            </Show>
            <button
              type="button"
              role="menuitem"
              class="selection-menu-item"
              onClick={() => runEdit(actions().addTags)}
            >
              {t('site.selection.addTag')}
            </button>
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
              {t('site.selection.moveToSection')}
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
                {t('site.selection.moveToList')}
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
        {t('site.selection.copyText')}
      </button>
      <button
        type="button"
        role="menuitem"
        class="selection-menu-item"
        onClick={() => void copy.copyCsv()}
      >
        {t('site.selection.copyCsv')}
      </button>
      <Show when={cartBuyer()}>
        {(buyer) => (
          <button
            type="button"
            role="menuitem"
            class="selection-menu-item"
            onClick={() => void copy.copyCart()}
          >
            {t('site.selection.copyCart', { buyer: buyerName(buyer()) })}
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
          {t('site.trade.addAction')}
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
          {t('site.selection.moveAllToList')}
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
            {t('site.selection.removeAll')}
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
        {props.clearLabel ?? t('site.selection.clear')}
      </button>
      <Show when={copy.status()}>
        <div class="selection-menu-status" aria-live="polite">
          {copy.status()}
        </div>
      </Show>
    </>
  )
}
