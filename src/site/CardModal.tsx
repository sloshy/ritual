import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, For, Show } from 'solid-js'
import { Modal } from '../ui/Modal'
import type { ScryfallCard } from '../types'
import { isCardSideways, isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost, OracleText } from './symbols'
import type { PriceCurrency } from '../price-currency'
import { getCardPrice, getCardPriceForFinish, formatPrice } from '../price-currency'
import { capitalize } from './utils'
import { findPrintingsAvailable, openFindPrintings } from './find-printings'

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
  onAddToTrade?: () => void
  addToTradeDisabled?: boolean
}

export const CardModal: Component<CardModalProps> = (props) => {
  const [showingBack, setShowingBack] = createSignal(false)
  const [showPrintings, setShowPrintings] = createSignal(false)
  const [showTags, setShowTags] = createSignal(false)
  const [printingsPage, setPrintingsPage] = createSignal(0)
  const [printingsSortField, setPrintingsSortField] =
    createSignal<PrintingsSortField>('released_at')
  const [printingsSortReversed, setPrintingsSortReversed] = createSignal(false)

  // Sub-view signals live in this (always-mounted) scope, so they persist across
  // open/close cycles and when the displayed card changes while the modal stays
  // open. Reset to the front/details view on (re)open or card change so a new card
  // never lands straight in the "other printings" or card-back view. (The brief
  // window before this effect runs is masked by the dialog's open animation.)
  createEffect(
    on(
      () => [props.open, props.cardName, props.card?.id],
      () => {
        setShowingBack(false)
        setShowPrintings(false)
        setShowTags(false)
        setPrintingsPage(0)
      },
    ),
  )

  const isDfc = createMemo(() => (props.card ? isDoubleFacedCard(props.card) : false))
  const imgSources = createMemo(() =>
    props.card ? resolveCardImageSources(props.card, Boolean(props.useScryfallImgUrls)) : null,
  )

  const isSideways = createMemo(() => isCardSideways(props.card))

  const oracleTags = createMemo(() => props.card?.oracleTags ?? [])
  const artTags = createMemo(() => props.card?.artTags ?? [])
  // Tags are baked onto cards at build time. A card the site was *not* built with
  // (e.g. added later via the editor's Scryfall search) — or one that genuinely has
  // no tags — carries neither list, so we surface an "incomplete cache" warning.
  const hasTags = createMemo(() => oracleTags().length > 0 || artTags().length > 0)

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
    <Modal
      open={props.open}
      onClose={props.onClose}
      size="xl"
      panelClass="card-modal"
      aria-label={`Card details: ${props.card?.name ?? props.cardName ?? 'Card'}`}
    >
      <button class="modal-close" aria-label="Close" onClick={props.onClose}>
        &times;
      </button>
      <Show
        when={showPrintings()}
        fallback={
          <>
            <div class={`card-modal-image ${isSideways() && !showingBack() ? 'sideways' : ''}`}>
              {/* Double-faced cards animate with the same 3D rotateY flip as the
                    list views (both faces stay mounted and the container rotates).
                    Sideways cards (Battles) keep the instant swap — rotating a
                    landscape front into a portrait back reads poorly. */}
              <Show
                when={isDfc() && imgSources()?.backImage && !isSideways()}
                fallback={
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
                }
              >
                <div class="card-modal-flip" classList={{ flipped: showingBack() }}>
                  <img src={imgSources()?.frontImage ?? ''} alt={props.cardName || ''} />
                  <img
                    class="card-modal-flip-back"
                    src={imgSources()?.backImage ?? ''}
                    alt={`${props.cardName ?? ''} (Back)`}
                  />
                </div>
              </Show>
              <Show when={isDfc() && imgSources()?.backImage}>
                <button class="flip-btn" onClick={() => setShowingBack((prev) => !prev)}>
                  Flip ⇄
                </button>
              </Show>
            </div>
            <div class="card-modal-details">
              <div class="modal-card-name">{props.card?.name ?? props.cardName}</div>
              <div class="modal-type-line">{props.card?.type_line}</div>
              <div class="modal-mana-cost">
                <Show when={props.card}>
                  {(card) => <ManaCost card={card()} isDFC={isDfc()} symbolMap={props.symbolMap} />}
                </Show>
              </div>
              <div class="modal-oracle-text">
                <Show when={props.card}>
                  {(card) => (
                    <OracleText card={card()} isDFC={isDfc()} symbolMap={props.symbolMap} />
                  )}
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
                  {(url) => (
                    <a href={url()} target="_blank" rel="noopener noreferrer">
                      View on Scryfall ↗
                    </a>
                  )}
                </Show>
                <Show when={props.printings.length > 0}>
                  <button onClick={() => setShowPrintings(true)}>
                    Other Printings ({props.printings.length})
                  </button>
                </Show>
                {/* Cross-list printing lookup; hidden where no FindPrintingsModal
                    is mounted (the admin app). */}
                <Show
                  when={
                    findPrintingsAvailable()
                      ? (props.card?.name ?? props.cardName ?? undefined)
                      : undefined
                  }
                >
                  {(name) => (
                    <button
                      onClick={() => {
                        openFindPrintings(name())
                        props.onClose()
                      }}
                    >
                      Find in Lists
                    </button>
                  )}
                </Show>
                <Show when={props.card}>
                  <button aria-expanded={showTags()} onClick={() => setShowTags((prev) => !prev)}>
                    Tags {showTags() ? '▾' : '▸'}
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
              <Show when={showTags()}>
                <Show
                  when={hasTags()}
                  fallback={
                    <div class="modal-tags-warning">
                      <span class="modal-tags-warning-icon" aria-hidden="true">
                        ⚠
                      </span>
                      <span>
                        No tag data for this card — the card cache is incomplete. Tags are only
                        available for cards the site was built with; rebuild the cache to include
                        them.
                      </span>
                    </div>
                  }
                >
                  <div class="modal-tags">
                    <Show when={oracleTags().length > 0}>
                      <div class="modal-tags-group">
                        <span class="modal-tags-label">Oracle Tags</span>
                        <div class="modal-tags-list">
                          <For each={oracleTags()}>
                            {(tag) => <span class="modal-tag">{tag}</span>}
                          </For>
                        </div>
                      </div>
                    </Show>
                    <Show when={artTags().length > 0}>
                      <div class="modal-tags-group">
                        <span class="modal-tags-label">Art Tags</span>
                        <div class="modal-tags-list">
                          <For each={artTags()}>
                            {(tag) => <span class="modal-tag">{tag}</span>}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>
              </Show>
            </div>
          </>
        }
      >
        {renderPrintingsView()}
      </Show>
    </Modal>
  )
}
