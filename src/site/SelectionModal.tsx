import type { Accessor, Component } from 'solid-js'
import { createSignal, createMemo, createEffect, For, Show } from 'solid-js'
import { Modal } from '../ui/Modal'
import type { NamedListRef } from './combined-list'
import type { CardSelectionControl, SelectedCard, SelectionSourceKind } from './useCardSelection'
import { groupSelectionsBySource } from './useCardSelection'
import { useSelectionCopy } from './useSelectionCopy'
import { promptListMove } from './move-prompt'
import { TooltipOverlay } from './TooltipOverlay'
import { useTooltip } from './useTooltip'
import { finishName } from './printing-display'
import { useT } from '../ui/i18n'
import type { TranslateFn } from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'
import { buyerName } from '../buylist'
import { cartBuyer } from './sell-mode'
import { BUYLIST_CURRENCY } from './card-sorting'
import { sellShortfallNote, summarizeSellValue } from './sell-value'
import { DEFAULT_CURRENCY, formatPrice, type PriceCurrency } from '../price-currency'

// Module-level open state so the modal can live at the app root (a proper
// full-screen overlay) while the navbar menu button toggles it.
const [viewOpen, setViewOpen] = createSignal(false)
export const isSelectionViewOpen: Accessor<boolean> = viewOpen
export function openSelectionView(): void {
  setViewOpen(true)
}
export function closeSelectionView(): void {
  setViewOpen(false)
}

type GroupMode = 'order' | 'source'

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
  open: boolean
  selection: CardSelectionControl
  onClose: () => void
  /** When set, show a "Remove all selected" action that deletes every selected card from its list. */
  onRemoveAll?: () => void
  /** When set (with {@link moveAllTargets}), show a "Move all to list" group moving each card from its own list. */
  onMoveAll?: (dest: NamedListRef) => void
  /** Destination lists for the "Move all to list" group (slug-bearing, so senders can address by slug). */
  moveAllTargets?: () => NamedListRef[]
  /** Active currency, for the selection's total value. */
  currency?: PriceCurrency
}

/**
 * "View all selections" dialog: lists every selected card and the list it came
 * from, groupable by source or shown in selection order. Individual cards can be
 * removed, and the copy/clear actions mirror the dropdown menu.
 */
export const SelectionModal: Component<SelectionModalProps> = (props) => {
  const t = useT()
  const [groupMode, setGroupMode] = createSignal<GroupMode>('order')
  const copy = useSelectionCopy(() => props.selection.selected())
  const sellSummary = createMemo(() => summarizeSellValue(props.selection.selected()))
  // Memoized so <For> gets a stable array; only recomputes when the selection changes.
  const groupedBySource = createMemo(() => groupSelectionsBySource(props.selection.selected()))

  // Hover preview of the card art, mirroring the list-view tooltip on list pages.
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()
  const showPreview = (card: SelectedCard) => {
    if (card.image) setTooltip({ src: card.image, sideways: Boolean(card.sideways) })
  }
  const hidePreview = () => setTooltip(null)

  // Reset the preview whenever the modal closes — mouseleave won't fire when the
  // rows are torn down by the <Show>, so the tooltip signal could otherwise stick.
  createEffect(() => {
    if (!props.open) hidePreview()
  })

  // Close once the selection empties (e.g. after removing the last card or Clear).
  createEffect(() => {
    if (props.open && props.selection.count() === 0) props.onClose()
  })

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
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
          {t('site.selection.modalTitle', { count: props.selection.count() })}
        </span>
        <span class="selection-modal-value">
          {formatPrice(
            props.selection.value(props.currency ?? DEFAULT_CURRENCY),
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
          onClick={props.onClose}
        >
          ×
        </button>
      </div>

      <div class="selection-modal-controls">
        <span class="selection-modal-controls-label">{t('site.selection.group')}</span>
        <div class="view-toggle">
          <button
            type="button"
            classList={{ active: groupMode() === 'order' }}
            onClick={() => setGroupMode('order')}
          >
            {t('site.selection.groupOrder')}
          </button>
          <button
            type="button"
            classList={{ active: groupMode() === 'source' }}
            onClick={() => setGroupMode('source')}
          >
            {t('site.selection.groupSource')}
          </button>
        </div>
      </div>

      <div class="selection-modal-list">
        <Show
          when={groupMode() === 'source'}
          fallback={
            <For each={props.selection.selected()}>
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

      <div class="selection-modal-actions">
        <button type="button" class="btn btn-secondary" onClick={() => void copy.copyText()}>
          {t('site.selection.copyText')}
        </button>
        <button type="button" class="btn btn-secondary" onClick={() => void copy.copyCsv()}>
          {t('site.selection.copyCsv')}
        </button>
        <Show when={cartBuyer()}>
          {(buyer) => (
            <button type="button" class="btn btn-secondary" onClick={() => void copy.copyCart()}>
              {t('site.selection.copyCart', { buyer: buyerName(buyer()) })}
            </button>
          )}
        </Show>
        <Show when={props.onMoveAll && (props.moveAllTargets?.().length ?? 0) > 0}>
          <button
            type="button"
            class="btn btn-secondary"
            onClick={() =>
              promptListMove(props.moveAllTargets?.() ?? [], (dest) => {
                props.onMoveAll!(dest)
                props.onClose()
              })
            }
          >
            {t('site.selection.moveAllToList')}
          </button>
        </Show>
        <Show when={props.onRemoveAll}>
          {(onRemoveAll) => (
            <button
              type="button"
              class="btn btn-danger"
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
          class="btn btn-secondary"
          onClick={() => {
            props.selection.clear()
            props.onClose()
          }}
        >
          {t('site.selection.clearAll')}
        </button>
        <Show when={copy.status()}>
          <span class="selection-modal-status" aria-live="polite">
            {copy.status()}
          </span>
        </Show>
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
