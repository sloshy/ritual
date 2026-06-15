import type { Accessor, Component } from 'solid-js'
import { createSignal, createMemo, createEffect, onCleanup, For, Show } from 'solid-js'
import type { CardSelectionControl, SelectedCard } from './useCardSelection'
import { groupSelectionsBySource } from './useCardSelection'
import { useSelectionCopy } from './useSelectionCopy'
import { useTooltip } from './useTooltip'
import { capitalize } from './utils'

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
}

/**
 * "View all selections" dialog: lists every selected card and the list it came
 * from, groupable by source or shown in selection order. Individual cards can be
 * removed, and the copy/clear actions mirror the dropdown menu.
 */
export const SelectionModal: Component<SelectionModalProps> = (props) => {
  const [groupMode, setGroupMode] = createSignal<GroupMode>('order')
  const copy = useSelectionCopy(() => props.selection.selected())
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

  // Escape closes the dialog while it is open.
  createEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    // `document` (not `window`), matching the other site modals' Escape handling.
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  return (
    <Show when={props.open}>
      <div class="selection-modal-overlay" onClick={props.onClose}>
        <div
          class="selection-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Selected cards"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="selection-modal-header">
            <span class="selection-modal-title">Selected Cards ({props.selection.count()})</span>
            <button
              type="button"
              class="selection-modal-close"
              aria-label="Close"
              onClick={props.onClose}
            >
              ✕
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
            <button
              type="button"
              class="site-btn site-btn-secondary"
              onClick={() => void copy.copyText()}
            >
              Copy as Text
            </button>
            <button
              type="button"
              class="site-btn site-btn-secondary"
              onClick={() => void copy.copyCsv()}
            >
              Copy as CSV
            </button>
            <button
              type="button"
              class="site-btn site-btn-secondary"
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
        </div>

        {/* Card-art hover preview — sibling of the modal so its overflow:hidden can't clip it. */}
        <div
          ref={tooltipRef}
          class={`list-tooltip selection-modal-tooltip ${tooltip() ? 'visible' : ''} ${
            tooltip()?.sideways ? 'list-tooltip-sideways' : ''
          }`}
          style={`left:${tooltipPos().left}px;top:${tooltipPos().top}px;`}
        >
          <Show when={tooltip()}>
            <img src={tooltip()!.src} alt="" class={tooltip()!.sideways ? 'tooltip-rotated' : ''} />
          </Show>
        </div>
      </div>
    </Show>
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
      ✕
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
