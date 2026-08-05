import type { Accessor, Component } from 'solid-js'
import { createSignal, createMemo, createEffect, For, Show } from 'solid-js'
import { Modal } from '../ui/Modal'
import type { NamedListRef } from './combined-list'
import type { CardSelectionControl, SelectedCard } from './useCardSelection'
import { groupSelectionsBySource } from './useCardSelection'
import { useSelectionCopy } from './useSelectionCopy'
import { promptListMove } from './move-prompt'
import { TooltipOverlay } from './TooltipOverlay'
import { useTooltip } from './useTooltip'
import { capitalize } from './utils'
import { BUYER_DISPLAY_NAMES } from '../buylist'
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

const sourceLabel = (kind: string, name: string): string => `${capitalize(kind)} · ${name}`

/** Parenthesised printing/finish/condition label, e.g. `(LEA:161 · Foil · LP)`, or null. */
function printingLabel(card: SelectedCard): string | null {
  const parts = [
    card.set && card.collectorNumber ? `${card.set.toUpperCase()}:${card.collectorNumber}` : null,
    card.finish && card.finish !== 'nonfoil' ? capitalize(card.finish) : null,
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
      aria-label="Selected cards"
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
        <span class="selection-modal-title">Selected Cards ({props.selection.count()})</span>
        <span class="selection-modal-value">
          {formatPrice(
            props.selection.value(props.currency ?? DEFAULT_CURRENCY),
            props.currency ?? DEFAULT_CURRENCY,
          )}
          <Show when={cartBuyer()}>
            {' · sell '}
            {formatPrice(sellSummary().value, BUYLIST_CURRENCY)}
            <Show when={sellShortfallNote(sellSummary())}>
              {(note) => <span class="selection-modal-note"> {note()}</span>}
            </Show>
          </Show>
        </span>
        <button
          type="button"
          class="selection-modal-close"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>

      <div class="selection-modal-controls">
        <span class="selection-modal-controls-label">Group:</span>
        <div class="view-toggle">
          <button
            type="button"
            classList={{ active: groupMode() === 'order' }}
            onClick={() => setGroupMode('order')}
          >
            Selection order
          </button>
          <button
            type="button"
            classList={{ active: groupMode() === 'source' }}
            onClick={() => setGroupMode('source')}
          >
            By source
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
                  {sourceLabel(group.kind, group.name)} ({group.cards.length})
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
          Copy as Text
        </button>
        <button type="button" class="btn btn-secondary" onClick={() => void copy.copyCsv()}>
          Copy as CSV
        </button>
        <Show when={cartBuyer()}>
          {(buyer) => (
            <button type="button" class="btn btn-secondary" onClick={() => void copy.copyCart()}>
              Copy {BUYER_DISPLAY_NAMES[buyer()]} cart CSV
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
            Move all to list…
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
              Remove all selected
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
          Clear all selections
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

const SelectionRow: Component<SelectionRowProps> = (props) => (
  <div class="selection-modal-row" onMouseEnter={props.onHover} onMouseLeave={props.onLeave}>
    <button
      type="button"
      class="selection-modal-row-remove"
      aria-label={`Remove ${props.card.name}`}
      title="Remove from selection"
      onClick={props.onRemove}
    >
      ×
    </button>
    <span class="selection-modal-row-qty">{props.card.quantity}×</span>
    <span class="selection-modal-row-name">{props.card.name}</span>
    <Show when={printingLabel(props.card)}>
      {(label) => <span class="selection-modal-row-printing">{label()}</span>}
    </Show>
    <Show when={props.showSource}>
      <span class="selection-modal-row-source">
        {sourceLabel(props.card.sourceKind, props.card.sourceName)}
      </span>
    </Show>
  </div>
)
