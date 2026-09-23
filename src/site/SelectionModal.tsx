import type { Accessor, Component } from 'solid-js'
import { createSignal, createMemo, createEffect, For, Show, onCleanup } from 'solid-js'
import { Modal } from '../ui/Modal'
import type {
  CardSelectionControl,
  SelectedCard,
  SelectionBulkActions,
  SelectionSourceKind,
} from '../list-view/useCardSelection'
import { groupSelectionsBySource } from '../list-view/useCardSelection'
import { useSelectionCopy } from './useSelectionCopy'
import { promptListMove } from '../list-view/move-prompt'
import { TooltipOverlay } from '../ui/TooltipOverlay'
import { useTooltip } from '../ui/useTooltip'
import { finishName } from '../list-view/printing-display'
import { useT } from '../ui/i18n'
import type { TranslateFn } from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'
import { cartBuyer } from '../list-view/sell-mode'
import { BUYLIST_CURRENCY } from '../list-view/card-sorting'
import { sellShortfallNote } from './sell-value'
import { createSellSummary } from './useSellMode'
import { DEFAULT_CURRENCY, formatPrice, type PriceCurrency } from '../pricing/price-currency'

/**
 * Which cards the dialog lists: the selection on the list page in view, or the
 * whole cross-list selection. The entry point picks the initial scope (the page
 * toolbar's menu opens on `current`, the navbar's on `all`); the dialog's toggle
 * switches between them.
 */
export type SelectionViewScope = 'current' | 'all'

// Module-level open state so the modal can live at the app root (a proper
// full-screen overlay) while the menu buttons toggle it. `null` is closed.
const [viewScope, setViewScope] = createSignal<SelectionViewScope | null>(null)
export const isSelectionViewOpen: Accessor<boolean> = () => viewScope() !== null
export function openSelectionView(scope: SelectionViewScope): void {
  setViewScope(scope)
}
export function closeSelectionView(): void {
  setViewScope(null)
}

// The selection of the list page in view, which the `current` scope shows. Held
// here rather than threaded from the app root, which does not know which page
// (or combined view) is mounted.
const [pageSelection, setPageSelection] = createSignal<CardSelectionControl | null>(null)

/**
 * Publish a list page's selection as the dialog's `current` scope for as long
 * as the calling component is mounted. Call from the page's setup.
 */
export function registerPageSelection(selection: CardSelectionControl): void {
  setPageSelection(() => selection)
  onCleanup(() => setPageSelection((prev) => (prev === selection ? null : prev)))
}

type GroupMode = 'order' | 'source'

/** The dialog's resolved scope and the selection control it shows. */
type ScopedSelection = { scope: SelectionViewScope; control: CardSelectionControl }

/**
 * The compact name of the kind of list a selected card came from. Keys, not
 * strings: this table is evaluated once at module load, so rendered text here
 * would survive a locale switch unchanged. The short singular forms are
 * deliberate — `domain.listTypeSingular.wanted` ("Wanted List") is a heading,
 * while this sits inline beside a card name.
 */
const SOURCE_KIND_LABELS = {
  deck: 'site.selection.sourceDeck',
  collection: 'site.selection.sourceCollection',
  wanted: 'site.selection.sourceWanted',
} as const satisfies Record<SelectionSourceKind, MessageKey>

const sourceLabel = (t: TranslateFn, kind: SelectionSourceKind, name: string): string =>
  `${t(SOURCE_KIND_LABELS[kind])} · ${name}`

/** Parenthesised printing/finish/condition label, e.g. `(LEA:161 · Foil · LP)`, or null. */
function printingLabel(t: TranslateFn, card: SelectedCard): string | null {
  const parts = [
    card.set && card.collectorNumber ? `${card.set.toUpperCase()}:${card.collectorNumber}` : null,
    card.finish && card.finish !== 'nonfoil' ? finishName(t, card.finish) : null,
    card.condition ?? null,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? `(${parts.join(' · ')})` : null
}

export interface SelectionModalProps {
  /** The cross-list selection, shown in the `all` scope. */
  selection: CardSelectionControl
  /** When set, show the "Move all to list" / "Remove all selected" row over the listed cards. */
  bulk?: SelectionBulkActions
  /** Active currency, for the selection's total value. */
  currency?: PriceCurrency
}

/**
 * "Selected Cards" dialog: lists the selected cards — on the list page in view,
 * or across every list — and the list each came from, groupable by source or
 * shown in selection order. Individual cards can be removed, and the copy/clear
 * actions mirror the dropdown menu. Its open state is module-level (see
 * {@link openSelectionView}), so it is mounted once at the app root.
 */
export const SelectionModal: Component<SelectionModalProps> = (props) => {
  const t = useT()
  const [groupMode, setGroupMode] = createSignal<GroupMode>('order')
  const open = isSelectionViewOpen
  const close = closeSelectionView
  // The `current` scope needs a list page in view; elsewhere it falls back to all.
  const scoped = createMemo((): ScopedSelection => {
    const page = pageSelection()
    return viewScope() === 'current' && page
      ? { scope: 'current', control: page }
      : { scope: 'all', control: props.selection }
  })
  const scope = (): SelectionViewScope => scoped().scope
  const selection = (): CardSelectionControl => scoped().control
  const copy = useSelectionCopy(() => selection().selected())
  // Gated on exactly what renders it below, so the walk-and-budget over the whole
  // cross-list selection does not run on every selection change while the figure
  // is hidden — a memo stays hot whether or not anything reads it.
  const sellSummary = createSellSummary(
    () => cartBuyer() !== undefined,
    () => selection().selected(),
  )
  // Memoized so <For> gets a stable array; only recomputes when the selection changes.
  const groupedBySource = createMemo(() => groupSelectionsBySource(selection().selected()))

  // Hover preview of the card art, mirroring the list-view tooltip on list pages.
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()
  const showPreview = (card: SelectedCard) => {
    if (card.image) setTooltip({ src: card.image, sideways: Boolean(card.sideways) })
  }
  const hidePreview = () => setTooltip(null)

  // Reset the preview whenever the modal closes — mouseleave won't fire when the
  // rows are torn down by the <Show>, so the tooltip signal could otherwise stick.
  createEffect(() => {
    if (!open()) hidePreview()
  })

  // Close once the whole selection empties (e.g. after removing the last card or
  // Clear). An empty `current` scope stays open: the other lists may still hold
  // cards, one toggle away.
  createEffect(() => {
    if (open() && props.selection.count() === 0) close()
  })

  return (
    <Modal
      open={open()}
      onClose={close}
      size="lg"
      aria-label={t('site.selection.modalAria')}
      panelClass="selection-modal"
      overlay={
        <TooltipOverlay
          tooltip={tooltip()}
          pos={tooltipPos()}
          tooltipRef={tooltipRef}
          class="selection-modal-tooltip"
        />
      }
    >
      <div class="selection-modal-header">
        <span class="selection-modal-title">
          {t('site.selection.modalTitle', { count: selection().count() })}
        </span>
        <span class="selection-modal-value">
          {formatPrice(
            selection().value(props.currency ?? DEFAULT_CURRENCY),
            props.currency ?? DEFAULT_CURRENCY,
          )}
          <Show when={cartBuyer()}>
            {' · '}
            {t('site.selection.sell')} {formatPrice(sellSummary().value, BUYLIST_CURRENCY)}
            <Show when={sellShortfallNote(sellSummary())}>
              {(note) => <span class="selection-modal-note"> {note()}</span>}
            </Show>
          </Show>
        </span>
        <button
          type="button"
          class="selection-modal-close"
          aria-label={t('ui.dialog.close')}
          onClick={close}
        >
          ×
        </button>
      </div>

      <div class="selection-modal-controls">
        <Show when={pageSelection()}>
          {(current) => (
            <>
              <span class="selection-modal-controls-label">{t('site.selection.scope')}</span>
              <div class="view-toggle selection-modal-scope">
                <button
                  type="button"
                  classList={{ active: scope() === 'current' }}
                  aria-pressed={scope() === 'current'}
                  onClick={() => setViewScope('current')}
                >
                  {t('site.selection.scopeCurrent', { count: current().count() })}
                </button>
                <button
                  type="button"
                  classList={{ active: scope() === 'all' }}
                  aria-pressed={scope() === 'all'}
                  onClick={() => setViewScope('all')}
                >
                  {t('site.selection.scopeAll', { count: props.selection.count() })}
                </button>
              </div>
            </>
          )}
        </Show>
        <span class="selection-modal-controls-label">{t('site.selection.group')}</span>
        <div class="view-toggle">
          <button
            type="button"
            classList={{ active: groupMode() === 'order' }}
            aria-pressed={groupMode() === 'order'}
            onClick={() => setGroupMode('order')}
          >
            {t('site.selection.groupOrder')}
          </button>
          <button
            type="button"
            classList={{ active: groupMode() === 'source' }}
            aria-pressed={groupMode() === 'source'}
            onClick={() => setGroupMode('source')}
          >
            {t('site.selection.groupSource')}
          </button>
        </div>
      </div>

      <div class="selection-modal-list">
        <Show when={scope() === 'current' && selection().count() === 0}>
          <p class="selection-modal-empty">{t('site.selection.emptyCurrent')}</p>
        </Show>
        <Show
          when={groupMode() === 'source'}
          fallback={
            <For each={selection().selected()}>
              {(card) => (
                <SelectionRow
                  card={card}
                  showSource
                  onRemove={() => props.selection.removeOne(card)}
                  onHover={() => showPreview(card)}
                  onLeave={hidePreview}
                />
              )}
            </For>
          }
        >
          <For each={groupedBySource()}>
            {(group) => (
              <div class="selection-modal-group">
                <div class="selection-modal-group-header">
                  {sourceLabel(t, group.kind, group.name)} ({group.cards.length})
                </div>
                <For each={group.cards}>
                  {(card) => (
                    <SelectionRow
                      card={card}
                      onRemove={() => props.selection.removeOne(card)}
                      onHover={() => showPreview(card)}
                      onLeave={hidePreview}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* One row per intent — copying out, editing the lists, and managing the
          selection itself — so the edit-mode actions wrap onto their own line
          instead of overflowing the panel. */}
      <div class="selection-modal-actions">
        <div class="selection-modal-action-row">
          <span class="selection-modal-action-label">{t('site.selection.actionsCopy')}</span>
          <div class="selection-modal-action-buttons">
            <button
              type="button"
              class={`btn btn-secondary ${copy.stateClass('text')}`}
              onClick={() => void copy.copyText()}
            >
              {copy.label('text')}
            </button>
            <button
              type="button"
              class={`btn btn-secondary ${copy.stateClass('csv')}`}
              onClick={() => void copy.copyCsv()}
            >
              {copy.label('csv')}
            </button>
            <Show when={cartBuyer()}>
              <button
                type="button"
                class={`btn btn-secondary ${copy.stateClass('cart')}`}
                onClick={() => void copy.copyCart()}
              >
                {copy.label('cart')}
              </button>
            </Show>
          </div>
        </div>
        <Show when={props.bulk}>
          {(bulk) => (
            <div class="selection-modal-action-row">
              <span class="selection-modal-action-label">{t('site.selection.actionsEdit')}</span>
              <div class="selection-modal-action-buttons">
                <Show when={bulk().moveTargets().length > 0}>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    onClick={() => {
                      // Snapshot now: the picker is asynchronous, and the scope,
                      // the selection, or edit mode may change before it resolves.
                      const { moveAll, moveTargets } = bulk()
                      const cards = selection().selected()
                      promptListMove(moveTargets(), (dest) => {
                        moveAll(dest, cards)
                        close()
                      })
                    }}
                  >
                    {t('site.selection.moveAllToList')}
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn btn-danger"
                  onClick={() => {
                    bulk().removeAll(selection().selected())
                    close()
                  }}
                >
                  {t('site.selection.removeAll')}
                </button>
              </div>
            </div>
          )}
        </Show>
        <div class="selection-modal-action-row">
          <span class="selection-modal-action-label">{t('site.selection.actionsSelection')}</span>
          <div class="selection-modal-action-buttons">
            <button
              type="button"
              class="btn btn-secondary"
              onClick={() => {
                selection().clear()
                if (scope() === 'all') close()
              }}
            >
              {scope() === 'current' ? t('site.selection.clear') : t('site.selection.clearAll')}
            </button>
          </div>
        </div>
        <For each={copy.cartWarnings()}>
          {(warning) => <p class="selection-menu-warning selection-modal-warning">{warning}</p>}
        </For>
        <span class="visually-hidden" aria-live="polite">
          {copy.announcement()}
        </span>
      </div>
    </Modal>
  )
}

type SelectionRowProps = {
  card: SelectedCard
  /** Show the source label inline (used in selection-order mode, where rows mix sources). */
  showSource?: boolean
  onRemove: () => void
  onHover: () => void
  onLeave: () => void
}

const SelectionRow: Component<SelectionRowProps> = (props) => {
  const t = useT()
  return (
    <div class="selection-modal-row" onMouseEnter={props.onHover} onMouseLeave={props.onLeave}>
      <button
        type="button"
        class="selection-modal-row-remove"
        aria-label={t('site.selection.removeCard', { name: props.card.name })}
        title={t('site.selection.removeFromSelection')}
        onClick={props.onRemove}
      >
        ×
      </button>
      <span class="selection-modal-row-qty">{props.card.quantity}×</span>
      <span class="selection-modal-row-name">{props.card.name}</span>
      <Show when={printingLabel(t, props.card)}>
        {(label) => <span class="selection-modal-row-printing">{label()}</span>}
      </Show>
      <Show when={props.showSource}>
        <span class="selection-modal-row-source">
          {sourceLabel(t, props.card.sourceKind, props.card.sourceName)}
        </span>
      </Show>
    </div>
  )
}
