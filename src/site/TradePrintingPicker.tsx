import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, For, Show } from 'solid-js'
import { Modal } from '../ui/Modal'
import type { ScryfallCard, Finish } from '../types'
import type { PriceCurrency } from '../price-currency'
import { formatPrice, getCardPriceForFinish } from '../price-currency'
import { isCardSideways, resolveCardImageSources } from './image-sources'
import { defaultFinishForCard } from './trade-finish'
import { useTooltip } from './useTooltip'

export interface TradePrintingPickerProps {
  cardName: string
  printings: ScryfallCard[]
  loading: boolean
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  onSelect: (printing: ScryfallCard, finish: Finish) => void
  onClose: () => void
}

const PRINTINGS_PAGE_SIZE = 8

interface PickerItemProps {
  printing: ScryfallCard
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  selectedPrinting: ScryfallCard | null
  selectedFinish: Finish
  onSelectPrinting: (printing: ScryfallCard) => void
  onSelectFinish: (printing: ScryfallCard, finish: Finish) => void
  onTooltipEnter: (src: string, sideways: boolean) => void
  onTooltipLeave: () => void
}

const PickerItem: Component<PickerItemProps> = (props) => {
  const { frontImage } = resolveCardImageSources(props.printing, Boolean(props.useScryfallImgUrls))
  const finishes: Finish[] = (props.printing.finishes as Finish[]).filter(
    (f): f is Finish => f === 'nonfoil' || f === 'foil' || f === 'etched',
  )
  if (finishes.length === 0) finishes.push('nonfoil')
  // Memoized so a currency change while the picker is open re-prices reactively.
  const prices = createMemo(() =>
    finishes.map((f) => ({
      finish: f,
      value: getCardPriceForFinish(props.printing, f, props.currency),
    })),
  )
  const handleEnter = () => {
    if (frontImage) props.onTooltipEnter(frontImage, isCardSideways(props.printing))
  }
  const isSelected = () => props.selectedPrinting?.id === props.printing.id

  return (
    <div
      class="trade-picker-item"
      classList={{ 'trade-picker-item-selected': isSelected() }}
      role="button"
      tabIndex={0}
      onClick={() => props.onSelectPrinting(props.printing)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') props.onSelectPrinting(props.printing)
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={props.onTooltipLeave}
    >
      <Show when={frontImage}>
        <img src={frontImage} alt={props.printing.name} class="trade-picker-thumb" />
      </Show>
      <div class="trade-picker-item-info">
        <span class="trade-picker-set">
          {props.printing.set.toUpperCase()}:{props.printing.collector_number}
        </span>
        <span class="trade-picker-release">{props.printing.released_at ?? ''}</span>
        <span class="trade-picker-price">
          <For each={prices()}>
            {(p, i) => (
              <>
                <Show when={i() > 0}> </Show>
                <span classList={{ 'trade-picker-price-secondary': i() > 0 }} title={p.finish}>
                  <Show when={i() > 0}>(</Show>
                  {p.value > 0 ? formatPrice(p.value, props.currency) : 'N/A'}
                  <Show when={i() > 0}> {p.finish})</Show>
                </span>
              </>
            )}
          </For>
        </span>
      </div>
      <div class="trade-picker-finish-btns">
        <For each={finishes}>
          {(finish) => (
            <button
              class="trade-picker-finish-btn"
              classList={{ active: isSelected() && props.selectedFinish === finish }}
              onClick={(e) => {
                e.stopPropagation()
                props.onSelectFinish(props.printing, finish)
              }}
            >
              {finish}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

export const TradePrintingPicker: Component<TradePrintingPickerProps> = (props) => {
  const [selectedPrinting, setSelectedPrinting] = createSignal<ScryfallCard | null>(null)
  const [selectedFinish, setSelectedFinish] = createSignal<Finish>('nonfoil')
  const [page, setPage] = createSignal(0)
  const [filterText, setFilterText] = createSignal('')

  const filteredPrintings = createMemo(() => {
    const filter = filterText().toLowerCase().trim()
    if (!filter) return props.printings
    return props.printings.filter((p) => p.set.toLowerCase().includes(filter))
  })

  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(filteredPrintings().length / PRINTINGS_PAGE_SIZE)),
  )

  const pagedPrintings = createMemo(() => {
    const start = page() * PRINTINGS_PAGE_SIZE
    return filteredPrintings().slice(start, start + PRINTINGS_PAGE_SIZE)
  })

  createEffect(() => {
    props.printings
    filterText()
    setPage(0)
  })

  createEffect(() => {
    const p = selectedPrinting()
    if (p) setSelectedFinish(defaultFinishForCard(p))
  })

  const handleConfirm = () => {
    const p = selectedPrinting()
    if (!p) return
    props.onSelect(p, selectedFinish())
  }

  // Own the hover preview so it renders inside the dialog's top layer (a
  // page-level tooltip would be occluded by the modal backdrop).
  const tip = useTooltip()

  return (
    <Modal
      open
      onClose={props.onClose}
      size="lg"
      aria-label={`Select printing for ${props.cardName}`}
      panelClass="trade-picker-modal"
      overlay={
        <div
          ref={tip.tooltipRef}
          class={`list-tooltip ${tip.tooltip() ? 'visible' : ''} ${
            tip.tooltip()?.sideways ? 'list-tooltip-sideways' : ''
          }`}
          style={`left:${tip.tooltipPos().left}px;top:${tip.tooltipPos().top}px;`}
        >
          <Show when={tip.tooltip()}>
            {(t) => <img src={t().src} alt="" class={t().sideways ? 'tooltip-rotated' : ''} />}
          </Show>
        </div>
      }
    >
      <div class="trade-picker-header">
        <span class="trade-picker-title">Select Printing: {props.cardName}</span>
        <button class="trade-picker-close" onClick={props.onClose}>
          ×
        </button>
      </div>
      <div class="trade-picker-filter-row">
        <input
          type="text"
          class="trade-picker-filter"
          placeholder="Filter by set code (e.g. mkm, lea)…"
          value={filterText()}
          onInput={(e) => setFilterText(e.target.value)}
          autocomplete="off"
        />
      </div>
      <Show when={props.loading}>
        <div class="trade-picker-loading">Loading printings…</div>
      </Show>
      <Show when={!props.loading}>
        <div class="trade-picker-list">
          <Show when={filteredPrintings().length === 0 && props.printings.length > 0}>
            <div class="trade-picker-loading">No printings match that set code.</div>
          </Show>
          <For each={pagedPrintings()}>
            {(printing) => (
              <PickerItem
                printing={printing}
                useScryfallImgUrls={props.useScryfallImgUrls}
                currency={props.currency}
                selectedPrinting={selectedPrinting()}
                selectedFinish={selectedFinish()}
                onSelectPrinting={setSelectedPrinting}
                onSelectFinish={(p, f) => {
                  setSelectedPrinting(p)
                  setSelectedFinish(f)
                }}
                onTooltipEnter={(src, sideways) => tip.setTooltip({ src, sideways })}
                onTooltipLeave={() => tip.setTooltip(null)}
              />
            )}
          </For>
        </div>
        <Show when={totalPages() > 1}>
          <div class="trade-picker-pagination">
            <button
              class="btn btn-secondary"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page() === 0}
            >
              ← Prev
            </button>
            <span class="trade-picker-pagination-info">
              Page {page() + 1} of {totalPages()} · {filteredPrintings().length} printings
            </span>
            <button
              class="btn btn-secondary"
              onClick={() => setPage((p) => Math.min(totalPages() - 1, p + 1))}
              disabled={page() >= totalPages() - 1}
            >
              Next →
            </button>
          </div>
        </Show>
        <Show when={selectedPrinting()}>
          <div class="trade-picker-actions">
            <button class="btn btn-success" onClick={handleConfirm}>
              Add to Trade
            </button>
            <button class="btn btn-secondary" onClick={props.onClose}>
              Cancel
            </button>
          </div>
        </Show>
      </Show>
    </Modal>
  )
}
