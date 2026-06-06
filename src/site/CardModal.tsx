import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, onMount, onCleanup, For, Show } from 'solid-js'
import type { ScryfallCard } from '../types'
import { isCardSideways, isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost, OracleText } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { getCardPrice, getCardPriceForFinish, formatPrice } from '../price-currency'
import { capitalize } from './utils'

type PrintingsSortField = 'released_at' | 'set_name' | 'price'

interface CardModalMetaEntry {
  label: string
  value: string
}

interface CardModalProps {
  open: boolean
  card: ScryfallCard | null
  cardName: string | null
  symbolMap: Record<string, string>
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  printings: ScryfallCard[]
  onClose: () => void
  meta?: CardModalMetaEntry[]
  note?: string
  backdropClass?: string
  onAddToTrade?: () => void
  addToTradeDisabled?: boolean
}

export const CardModal: Component<CardModalProps> = (props) => {
  const [showingBack, setShowingBack] = createSignal(false)
  const [showPrintings, setShowPrintings] = createSignal(false)
  const [printingsPage, setPrintingsPage] = createSignal(0)
  const [printingsSortField, setPrintingsSortField] =
    createSignal<PrintingsSortField>('released_at')
  const [printingsSortReversed, setPrintingsSortReversed] = createSignal(false)

  // The modal stays mounted and is toggled via the `open` class, so its sub-view
  // signals would otherwise persist between cards. Reset to the front/details view
  // whenever the modal (re)opens or the displayed card changes, so opening a new
  // card never lands straight in the "other printings" or card-back view.
  createEffect(
    on(
      () => [props.open, props.cardName, props.card?.id],
      () => {
        setShowingBack(false)
        setShowPrintings(false)
        setPrintingsPage(0)
      },
    ),
  )

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })

  const isDfc = createMemo(() => (props.card ? isDoubleFacedCard(props.card) : false))
  const imgSources = createMemo(() =>
    props.card ? resolveCardImageSources(props.card, Boolean(props.useScryfallImgUrls)) : null,
  )

  const isSideways = createMemo(() => isCardSideways(props.card))

  const scryfallUrl = createMemo(() =>
    props.card
      ? `https://scryfall.com/card/${props.card.set}/${props.card.collector_number}`
      : null,
  )

  const defaultMeta = createMemo((): CardModalMetaEntry[] => {
    if (props.meta) return props.meta
    const parts: CardModalMetaEntry[] = []
    if (props.card) {
      const price = getCardPrice(props.card, props.currency)
      if (price > 0) parts.push({ label: 'price', value: formatPrice(price, props.currency) })
      parts.push({
        label: 'set',
        value: `${props.card.set_name} (#${props.card.collector_number})`,
      })
      parts.push({
        label: 'rarity',
        value: capitalize(props.card.rarity),
      })
    }
    return parts
  })

  const PRINTINGS_PAGE_SIZE = 8

  const sortedPrintings = createMemo(() => {
    const sorted = [...props.printings]
    const dir = printingsSortReversed() ? -1 : 1
    sorted.sort((a, b) => {
      switch (printingsSortField()) {
        case 'released_at': {
          const da = a.released_at ?? ''
          const db = b.released_at ?? ''
          return dir * db.localeCompare(da)
        }
        case 'set_name': {
          const cmp = a.set_name.localeCompare(b.set_name)
          if (cmp !== 0) return dir * cmp
          const na = parseInt(a.collector_number, 10) || 0
          const nb = parseInt(b.collector_number, 10) || 0
          return dir * (na - nb)
        }
        case 'price': {
          const pa = getCardPrice(a, props.currency)
          const pb = getCardPrice(b, props.currency)
          return dir * (pb - pa)
        }
        default:
          return 0
      }
    })
    return sorted
  })

  const totalPrintingsPages = createMemo(() =>
    Math.ceil(sortedPrintings().length / PRINTINGS_PAGE_SIZE),
  )
  const paginatedPrintings = createMemo(() =>
    sortedPrintings().slice(
      printingsPage() * PRINTINGS_PAGE_SIZE,
      (printingsPage() + 1) * PRINTINGS_PAGE_SIZE,
    ),
  )

  const renderPrintingsView = () => (
    <div class="modal-printings-view">
      <div class="modal-printings-header">
        <button class="modal-printings-back" onClick={() => setShowPrintings(false)}>
          ← Back
        </button>
        <h3>
          Other Printings of {props.card?.name ?? props.cardName ?? 'Unknown'} (
          {props.printings.length})
        </h3>
        <div class="printings-sort-controls">
          <select
            class="printings-sort-select"
            value={printingsSortField()}
            onChange={(e) => {
              setPrintingsSortField(e.target.value as PrintingsSortField)
              setPrintingsPage(0)
            }}
          >
            <option value="released_at">Release Date</option>
            <option value="set_name">Set Name</option>
            <option value="price">Price</option>
          </select>
          <button
            class="printings-sort-reverse"
            title={printingsSortReversed() ? 'Reversed' : 'Normal order'}
            onClick={() => {
              setPrintingsSortReversed((prev) => !prev)
              setPrintingsPage(0)
            }}
          >
            {printingsSortReversed() ? '↑' : '↓'}
          </button>
        </div>
      </div>
      <div class="modal-printings-grid">
        <For each={paginatedPrintings()}>
          {(p) => {
            const pImg = p.image_uris?.normal ?? p.card_faces?.[0]?.image_uris?.normal ?? ''
            const pUrl = `https://scryfall.com/card/${p.set}/${p.collector_number}`
            const isFoil = p.finishes?.length === 1 && p.finishes[0] !== 'nonfoil'
            const pPrice = getCardPriceForFinish(
              p,
              isFoil ? p.finishes[0]! : 'nonfoil',
              props.currency,
            )
            return (
              <a
                href={pUrl}
                target="_blank"
                rel="noopener noreferrer"
                class={`modal-printing-card${isFoil ? ' foil-card' : ''}`}
                title={`${p.set_name} (${p.set.toUpperCase()}:${p.collector_number})`}
              >
                <Show when={pImg}>
                  <img src={pImg} alt={`${p.name} (${p.set.toUpperCase()})`} loading="lazy" />
                </Show>
                <div class="printing-label">
                  <span class="printing-label-set">
                    {p.set.toUpperCase()}:{p.collector_number}
                  </span>
                  <Show when={pPrice > 0}>
                    {' '}
                    <span class="printing-label-price">{formatPrice(pPrice, props.currency)}</span>
                  </Show>
                </div>
              </a>
            )
          }}
        </For>
      </div>
      <Show when={totalPrintingsPages() > 1}>
        <div class="modal-printings-pagination">
          <button
            disabled={printingsPage() === 0}
            onClick={() => setPrintingsPage(printingsPage() - 1)}
          >
            ← Prev
          </button>
          <span>
            Page {printingsPage() + 1} of {totalPrintingsPages()}
          </span>
          <button
            disabled={printingsPage() >= totalPrintingsPages() - 1}
            onClick={() => setPrintingsPage(printingsPage() + 1)}
          >
            Next →
          </button>
        </div>
      </Show>
    </div>
  )

  return (
    <div
      class={`card-modal-backdrop ${props.open ? 'open' : ''}${props.backdropClass ? ` ${props.backdropClass}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Card details: ${props.card?.name ?? props.cardName ?? 'Card'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class="card-modal">
        <button class="modal-close" aria-label="Close" onClick={props.onClose}>
          &times;
        </button>
        <Show
          when={showPrintings()}
          fallback={
            <>
              <div class="card-modal-image">
                <Show
                  when={!showingBack()}
                  fallback={
                    <img
                      src={imgSources()?.backImage ?? ''}
                      alt={`${props.cardName ?? ''} (Back)`}
                    />
                  }
                >
                  <img
                    src={imgSources()?.frontImage ?? ''}
                    alt={props.cardName || ''}
                    class={isSideways() ? 'sideways' : ''}
                  />
                </Show>
                <Show when={isDfc() && imgSources()?.backImage}>
                  <button class="flip-btn" onClick={() => setShowingBack((prev) => !prev)}>
                    Flip ↻
                  </button>
                </Show>
              </div>
              <div class="card-modal-details">
                <div class="modal-card-name">{props.card?.name ?? props.cardName}</div>
                <div class="modal-type-line">{props.card?.type_line}</div>
                <div class="modal-mana-cost">
                  <Show when={props.card}>
                    <ManaCost card={props.card!} isDFC={isDfc()} symbolMap={props.symbolMap} />
                  </Show>
                </div>
                <div class="modal-oracle-text">
                  <Show when={props.card}>
                    <OracleText card={props.card!} isDFC={isDfc()} symbolMap={props.symbolMap} />
                  </Show>
                </div>
                <div class="modal-meta">
                  <For each={defaultMeta()}>{(m) => <span>{m.value}</span>}</For>
                </div>
                <Show when={props.note}>
                  <div class="modal-note">NOTE: {props.note}</div>
                </Show>
                <div class="modal-actions">
                  <Show when={scryfallUrl()}>
                    <a href={scryfallUrl()!} target="_blank" rel="noopener noreferrer">
                      View on Scryfall ↗
                    </a>
                  </Show>
                  <Show when={props.printings.length > 0}>
                    <button onClick={() => setShowPrintings(true)}>
                      Other Printings ({props.printings.length})
                    </button>
                  </Show>
                  <Show when={props.onAddToTrade !== undefined}>
                    <button
                      onClick={props.onAddToTrade}
                      disabled={props.addToTradeDisabled}
                      title={
                        props.addToTradeDisabled ? 'Already at maximum quantity' : 'Add to trade'
                      }
                    >
                      + Add to Trade
                    </button>
                  </Show>
                </div>
              </div>
            </>
          }
        >
          {renderPrintingsView()}
        </Show>
      </div>
    </div>
  )
}
