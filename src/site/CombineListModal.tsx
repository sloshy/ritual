import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, For, Show } from 'solid-js'
import { Modal } from '../ui/Modal'
import { compareDisplay } from '../i18n/collate'
import type { DeckSummary, CollectionSummary, WantedListSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { formatPriceWithMissing } from '../price-currency'
import { getSummaryMissingPriceCount, getSummaryTotalPrice } from './utils'
import { LIST_TYPE_DISPLAY, listTypeTitle, type ListType } from '../list-type'
import type { MessageKey } from '../i18n/messages/en'
import { useI18n } from '../ui/i18n'
import {
  listRefKey,
  type CombinedSelection,
  type CombinedListRef,
  type NamedListRef,
} from './combined-list'

/** A single selectable list in the modal, flattened from the per-type summaries. */
interface ListChoice {
  ref: NamedListRef
  cardCount: number
  total: number
  missing: number
}

type CombineSort = 'name' | 'count' | 'type'

/**
 * A sort choice. `label` is a {@link MessageKey}, not rendered text: this table
 * is evaluated once at module load, so a string here would freeze the dropdown
 * in the boot-time language after a locale switch.
 */
type SortOption = { value: CombineSort; label: MessageKey }

const SORT_OPTIONS = [
  { value: 'name', label: 'site.combine.sortName' },
  { value: 'count', label: 'site.combine.sortCount' },
  { value: 'type', label: 'site.combine.sortType' },
] as const satisfies readonly SortOption[]

const TYPE_ORDER: Record<ListType, number> = { deck: 0, collection: 1, wanted: 2 }

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
  const { t, tSegments } = useI18n()
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
      if (s === 'count') return b.cardCount - a.cardCount || compareDisplay(a.ref.name, b.ref.name)
      if (s === 'type') {
        return (
          TYPE_ORDER[a.ref.type] - TYPE_ORDER[b.ref.type] || compareDisplay(a.ref.name, b.ref.name)
        )
      }
      return compareDisplay(a.ref.name, b.ref.name)
    })
    return list
  })

  const isChecked = (ref: CombinedListRef): boolean => all() || selected().has(listRefKey(ref))

  const toggle = (ref: CombinedListRef): void => {
    if (all()) return
    setSelected((prev) => {
      const next = new Set(prev)
      const key = listRefKey(ref)
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
    const others: CombinedListRef[] = sortedChoices()
      .filter((c) => selected().has(listRefKey(c.ref)))
      .map((c) => ({ type: c.ref.type, slug: c.ref.slug }))
    const refs: CombinedListRef[] = props.current
      ? [{ type: props.current.type, slug: props.current.slug }, ...others]
      : others
    props.onView({ all: false, refs })
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      size="lg"
      aria-label={t('site.combine.title')}
      panelClass="combine-modal"
    >
      <div class="combine-modal-header">
        <div>
          <h2 class="combine-modal-title">{t('site.combine.title')}</h2>
          <Show when={props.current}>
            {(cur) => (
              <p class="combine-modal-subtitle">
                {/* Segments, not a split sentence: the list name is emphasized
                    wherever the translator places it. */}
                <For each={tSegments('site.combine.combiningWith', { name: cur().name })}>
                  {(segment) =>
                    segment.kind === 'param' ? <strong>{segment.value}</strong> : segment.value
                  }
                </For>
              </p>
            )}
          </Show>
        </div>
        <button
          type="button"
          class="combine-modal-close"
          aria-label={t('ui.dialog.close')}
          onClick={props.onClose}
        >
          ×
        </button>
      </div>

      <div class="combine-modal-controls">
        <label class="combine-modal-all">
          <input
            type="checkbox"
            checked={all()}
            onChange={(e) => setAll(e.currentTarget.checked)}
          />
          <span>{t('site.combine.allLists')}</span>
        </label>
        <div class="combine-modal-sort">
          <label class="toolbar-label">{t('site.combine.sortLabel')}</label>
          <select
            class="toolbar-select"
            value={sort()}
            onChange={(e) => setSort(e.currentTarget.value as CombineSort)}
          >
            <For each={SORT_OPTIONS}>
              {(opt) => <option value={opt.value}>{t(opt.label)}</option>}
            </For>
          </select>
        </div>
      </div>

      <div class="combine-modal-list">
        <Show
          when={sortedChoices().length > 0}
          fallback={<div class="combine-modal-empty">{t('site.combine.empty')}</div>}
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
                  {listTypeTitle(choice.ref.type)}
                </span>
                <span class="combine-modal-row-count">
                  {t('domain.count.cards', { count: choice.cardCount })}
                </span>
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
            ? t('site.combine.allSelected')
            : t('site.combine.selected', { count: selectedCount() })}
        </span>
        <button type="button" class="btn btn-export" disabled={!canView()} onClick={view}>
          {t('site.combine.view')}
        </button>
      </div>
    </Modal>
  )
}
