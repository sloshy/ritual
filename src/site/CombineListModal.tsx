import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, For, Show } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { formatPriceWithMissing } from '../price-currency'
import { pluralizeCards } from '../deck-format'
import { getSummaryMissingPriceCount, getSummaryTotalPrice } from './utils'
import { LIST_TYPE_DISPLAY, type ListType } from '../list-type'
import type { CombinedSelection, ListRef, NamedListRef } from './combined-list'

/** A single selectable list in the modal, flattened from the per-type summaries. */
interface ListChoice {
  ref: NamedListRef
  cardCount: number
  total: number
  missing: number
}

type CombineSort = 'name' | 'count' | 'type'
type SortOption = { value: CombineSort; label: string }

const SORT_OPTIONS: SortOption[] = [
  { value: 'name', label: 'Name' },
  { value: 'count', label: 'Card Count' },
  { value: 'type', label: 'Type' },
]

const TYPE_ORDER: Record<ListType, number> = { deck: 0, collection: 1, wanted: 2 }

const refKey = (ref: ListRef): string => `${ref.type}:${ref.slug}`

interface CombineListModalProps {
  open: boolean
  onClose: () => void
  /** The list currently in view — always included in the combination, shown as context. */
  current?: NamedListRef
  decks: DeckSummary[]
  collections: CollectionSummary[]
  wantedLists: WantedListSummary[]
  currency: PriceCurrency
  onView: (selection: CombinedSelection) => void
}

export const CombineListModal: Component<CombineListModalProps> = (props) => {
  const [selected, setSelected] = createSignal<Set<string>>(new Set<string>())
  const [all, setAll] = createSignal(false)
  const [sort, setSort] = createSignal<CombineSort>('name')

  // Reset the selection each time the modal is opened so it never carries stale picks.
  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          setSelected(new Set<string>())
          setAll(false)
          setSort('name')
        }
      },
      { defer: true },
    ),
  )

  // Every list except the one currently in view (which is always part of the combination).
  const choices = createMemo<ListChoice[]>(() => {
    const cur = props.current
    const out: ListChoice[] = []
    const add = (
      ref: NamedListRef,
      summary: DeckSummary | CollectionSummary | WantedListSummary,
    ) => {
      if (cur && cur.type === ref.type && cur.slug === ref.slug) return
      out.push({
        ref,
        cardCount: summary.cardCount,
        total: getSummaryTotalPrice(summary, props.currency),
        missing: getSummaryMissingPriceCount(summary, props.currency),
      })
    }
    for (const d of props.decks) add({ type: 'deck', slug: d.slug, name: d.name }, d)
    for (const c of props.collections) add({ type: 'collection', slug: c.slug, name: c.name }, c)
    for (const w of props.wantedLists) add({ type: 'wanted', slug: w.slug, name: w.name }, w)
    return out
  })

  const sortedChoices = createMemo<ListChoice[]>(() => {
    const list = [...choices()]
    const s = sort()
    list.sort((a, b) => {
      if (s === 'count') return b.cardCount - a.cardCount || a.ref.name.localeCompare(b.ref.name)
      if (s === 'type') {
        return (
          TYPE_ORDER[a.ref.type] - TYPE_ORDER[b.ref.type] || a.ref.name.localeCompare(b.ref.name)
        )
      }
      return a.ref.name.localeCompare(b.ref.name)
    })
    return list
  })

  const isChecked = (ref: ListRef): boolean => all() || selected().has(refKey(ref))

  const toggle = (ref: ListRef): void => {
    if (all()) return
    setSelected((prev) => {
      const next = new Set(prev)
      const key = refKey(ref)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedCount = createMemo(() => (all() ? choices().length : selected().size))
  const canView = createMemo(() => all() || selected().size > 0)

  const view = (): void => {
    if (!canView()) return
    if (all()) {
      props.onView({ all: true, refs: [] })
      return
    }
    const others: ListRef[] = sortedChoices()
      .filter((c) => selected().has(refKey(c.ref)))
      .map((c) => ({ type: c.ref.type, slug: c.ref.slug }))
    const refs: ListRef[] = props.current
      ? [{ type: props.current.type, slug: props.current.slug }, ...others]
      : others
    props.onView({ all: false, refs })
  }

  return (
    <Show when={props.open}>
      <div
        class="combine-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Combine with list"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class="combine-modal">
          <div class="combine-modal-header">
            <div>
              <h2 class="combine-modal-title">Combine with list</h2>
              <Show when={props.current}>
                {(cur) => (
                  <p class="combine-modal-subtitle">
                    Combining with <strong>{cur().name}</strong>
                  </p>
                )}
              </Show>
            </div>
            <button
              type="button"
              class="combine-modal-close"
              aria-label="Close"
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>

          <div class="combine-modal-controls">
            <label class="combine-modal-all">
              <input
                type="checkbox"
                checked={all()}
                onChange={(e) => setAll(e.currentTarget.checked)}
              />
              <span>All lists</span>
            </label>
            <div class="combine-modal-sort">
              <label class="toolbar-label">Sort:</label>
              <select
                class="toolbar-select"
                value={sort()}
                onChange={(e) => setSort(e.currentTarget.value as CombineSort)}
              >
                <For each={SORT_OPTIONS}>
                  {(opt) => <option value={opt.value}>{opt.label}</option>}
                </For>
              </select>
            </div>
          </div>

          <div class="combine-modal-list">
            <Show
              when={sortedChoices().length > 0}
              fallback={<div class="combine-modal-empty">No other lists to combine with.</div>}
            >
              <For each={sortedChoices()}>
                {(choice) => (
                  <label class="combine-modal-row" classList={{ 'is-disabled': all() }}>
                    <input
                      type="checkbox"
                      checked={isChecked(choice.ref)}
                      disabled={all()}
                      onChange={() => toggle(choice.ref)}
                    />
                    <span class="combine-modal-row-name">{choice.ref.name}</span>
                    <span class="combine-modal-row-type">
                      <span aria-hidden="true">{LIST_TYPE_DISPLAY[choice.ref.type].icon}</span>{' '}
                      {LIST_TYPE_DISPLAY[choice.ref.type].label}
                    </span>
                    <span class="combine-modal-row-count">{pluralizeCards(choice.cardCount)}</span>
                    <span class="combine-modal-row-price">
                      {formatPriceWithMissing(choice.total, props.currency, choice.missing)}
                    </span>
                  </label>
                )}
              </For>
            </Show>
          </div>

          <div class="combine-modal-footer">
            <span class="combine-modal-footer-info">
              {all()
                ? 'All lists selected'
                : `${selectedCount()} list${selectedCount() === 1 ? '' : 's'} selected`}
            </span>
            <button
              type="button"
              class="site-btn site-btn-export"
              disabled={!canView()}
              onClick={view}
            >
              View
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
