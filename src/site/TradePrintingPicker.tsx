import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, For, Show } from 'solid-js'
import { Modal } from '../ui/Modal'
import type { ScryfallCard, Finish } from '../types'
import type { PriceCurrency } from '../price-currency'
import { formatPrice, getCardPriceForFinish } from '../price-currency'
import { isFinish } from '../finish-condition'
import { isCardSideways, resolveCardImageSources } from './image-sources'
import { defaultFinishForCard } from './trade-finish'
import { printingKey } from '../printing-key'
import { resolvePrintingLanguage } from '../printing-language'
import { formatLanguageList, type CardLanguage } from '../card-language'
import { defaultLanguage } from '../editor/default-language'
import { pickedPrintingLanguage } from './printing-prompt'
import { useTooltip } from './useTooltip'

export interface TradePrintingPickerProps {
  cardName: string
  printings: ScryfallCard[]
  /**
   * `set:collectorNumber` keys of the printings a wanted list asks for. They are
   * floated to the top of the list and badged — a hint about what you wanted,
   * never a substitute for choosing the printing actually on offer.
   */
  desiredPrintings?: string[]
  loading: boolean
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  onSelect: (printing: ScryfallCard, finish: Finish) => void
  onClose: () => void
}

const PRINTINGS_PAGE_SIZE = 8

interface PickerItemProps {
  printing: ScryfallCard
  desired: boolean
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
  const finishes: Finish[] = props.printing.finishes.filter(isFinish)
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
      classList={{
        'trade-picker-item-selected': isSelected(),
        'trade-picker-item-desired': props.desired,
      }}
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
          <Show when={pickedPrintingLanguage(props.printing)}>
            {(lang) => <> · {lang().toUpperCase()}</>}
          </Show>
          <Show when={props.desired}>
            <span class="trade-picker-wanted-tag">Wanted</span>
          </Show>
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
  // Set when confirming a printing that exists only in a non-default language:
  // the pick pauses on a "Only available in <language>" notice whose Continue
  // stamps that language (the object itself carries it) and whose Back returns
  // to the list. A deliberate pick of an alternate-language object *alongside*
  // a default-language one is badged in the list and needs no notice.
  const [languageNotice, setLanguageNotice] = createSignal<CardLanguage | null>(null)

  const desired = createMemo(() => new Set(props.desiredPrintings ?? []))
  const isDesired = (printing: ScryfallCard): boolean =>
    desired().has(printingKey(printing.set, printing.collector_number))

  const filteredPrintings = createMemo(() => {
    const filter = filterText().toLowerCase().trim()
    if (!filter) return props.printings
    return props.printings.filter((p) => p.set.toLowerCase().includes(filter))
  })

  // Wanted printings lead so they're on the first page rather than buried
  // several pages into a heavily reprinted card; the rest keep their order.
  const orderedPrintings = createMemo(() => {
    const printings = filteredPrintings()
    if (desired().size === 0) return printings
    const wanted: ScryfallCard[] = []
    const rest: ScryfallCard[] = []
    for (const printing of printings) (isDesired(printing) ? wanted : rest).push(printing)
    return [...wanted, ...rest]
  })

  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(orderedPrintings().length / PRINTINGS_PAGE_SIZE)),
  )

  const pagedPrintings = createMemo(() => {
    const start = page() * PRINTINGS_PAGE_SIZE
    return orderedPrintings().slice(start, start + PRINTINGS_PAGE_SIZE)
  })

  createEffect(
    on(
      () => [props.printings, props.desiredPrintings, filterText()],
      () => setPage(0),
    ),
  )

  // Explicitly keyed on the selection: picking a different printing resets the
  // finish default and dismisses any pending language notice.
  createEffect(
    on(selectedPrinting, (p) => {
      if (p) setSelectedFinish(defaultFinishForCard(p))
      setLanguageNotice(null)
    }),
  )

  const handleConfirm = () => {
    const p = selectedPrinting()
    if (!p) return
    const language = pickedPrintingLanguage(p)
    // Notices only when the default language is unavailable — unlike
    // CardSearchModal's always-notice rule, because this list shows one row per
    // language, so picking a non-default row is already an explicit choice.
    if (language && languageNotice() === null) {
      const resolved = resolvePrintingLanguage(
        props.printings,
        p.set,
        p.collector_number,
        defaultLanguage(),
      )
      if (!resolved.honoredPreferred) {
        setLanguageNotice(language)
        return
      }
    }
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
          <Show when={orderedPrintings().length === 0 && props.printings.length > 0}>
            <div class="trade-picker-loading">No printings match that set code.</div>
          </Show>
          <For each={pagedPrintings()}>
            {(printing) => (
              <PickerItem
                printing={printing}
                desired={isDesired(printing)}
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
              Page {page() + 1} of {totalPages()} · {orderedPrintings().length} printings
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
          <Show
            when={languageNotice()}
            fallback={
              <div class="trade-picker-actions">
                <button class="btn btn-success" onClick={handleConfirm}>
                  Add to Trade
                </button>
                <button class="btn btn-secondary" onClick={props.onClose}>
                  Cancel
                </button>
              </div>
            }
          >
            {(notice) => (
              <div class="trade-picker-actions">
                <span class="trade-picker-language-notice">
                  This printing is only available in {formatLanguageList([notice()])} — it will be
                  recorded as [{notice()}].
                </span>
                <button class="btn btn-success" onClick={handleConfirm}>
                  Continue
                </button>
                <button class="btn btn-secondary" onClick={() => setLanguageNotice(null)}>
                  Back
                </button>
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </Modal>
  )
}
