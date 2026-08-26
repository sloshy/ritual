import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, For, Show } from 'solid-js'
import { Modal } from '../ui/Modal'
import { compareData, compareDisplay } from '../i18n/collate'
import type { ScryfallCard } from '../scryfall/types'
import { isCardSideways, isDoubleFacedCard, resolveCardImageSources } from './image-sources'
import { ManaCost, OracleText } from './symbols'
import type { PriceCurrency } from '../pricing/price-currency'
import { formatPrice } from '../pricing/price-currency'
import { pricesEnabled, sitePrice } from './price-view'
import { PriceSourceSelect } from './PriceSourceSelect'
import { PrintingPrices } from './PrintingPrices'
import { printingSortPrice } from './printing-prices'
import { usePrintingQuotes } from './printing-quotes'
import { languageBadge, scryfallCardLanguage } from '../card/card-language'
import { rarityName } from './printing-display'
import { cardPricelessMarkerText } from './priceless'
import { useT } from '../ui/i18n'
import { findPrintingsAvailable, openFindPrintings } from './find-printings'
// The one shared declaration: this component renders every page's meta table, so a
// local copy could only ever drift from the tables it is handed.
import type { MetaEntry } from './meta-entry'

type PrintingsSortField = 'released_at' | 'set_name' | 'price'

interface CardModalProps {
  open: boolean
  card: ScryfallCard | null
  /**
   * The entry's custom art, replacing the modal's main **front** image only.
   * The "other printings" grid below keeps the real printing thumbnails — that
   * list exists to show what the printings actually look like.
   */
  customArt?: string
  /**
   * Whether the entry has custom art at all. Read by the default price line
   * below, which must show the `CUSTOM` marker for a reference whose file the
   * build could not deploy too — that card shows its real printing and still
   * has no price.
   */
  hasCustomArt?: boolean
  cardName: string | null
  symbolMap: Record<string, string>
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  printings: ScryfallCard[]
  onClose: () => void
  meta?: MetaEntry[]
  note?: string
  onAddToTrade?: () => void
  addToTradeDisabled?: boolean
}

export const CardModal: Component<CardModalProps> = (props) => {
  const t = useT()
  const [showingBack, setShowingBack] = createSignal(false)
  const [showPrintings, setShowPrintings] = createSignal(false)
  const [showTags, setShowTags] = createSignal(false)
  const [printingsPage, setPrintingsPage] = createSignal(0)
  const [printingsSortField, setPrintingsSortField] =
    createSignal<PrintingsSortField>('released_at')
  const [printingsSortReversed, setPrintingsSortReversed] = createSignal(false)

  // Sub-view signals live in this (always-mounted) scope, so they persist across
  // open/close cycles and when the displayed card changes while the modal stays
  // open. Reset to the front/details view on (re)open or when a *different card*
  // is shown, so a new card never lands straight in the "other printings" or
  // card-back view. (The brief window before this effect runs is masked by the
  // dialog's open animation.)
  //
  // Keyed on the name rather than the printing: the displayed printing of one
  // name swaps under the user (the price-source selector, the lowest-price
  // toggle), and throwing them back to the details view for that would close the
  // very grid the source selector lives in.
  //
  // A *memo* over a string key, not the bare tuple accessor this used to be.
  // `on` re-runs whenever its input re-evaluates — it performs no equality check
  // of its own — and `open` is a page memo over the displayed card object, which
  // re-evaluates when the price source swaps the printing. Only a memo's `===`
  // gate stops that from reading as "a different card was opened" and throwing
  // the user out of the very grid the source selector lives in.
  const viewKey = createMemo(() => `${props.open}|${props.cardName ?? ''}`)
  createEffect(
    on(viewKey, () => {
      setShowingBack(false)
      setShowPrintings(false)
      setShowTags(false)
      setPrintingsPage(0)
    }),
  )

  const isDfc = createMemo(() => (props.card ? isDoubleFacedCard(props.card) : false))
  const imgSources = createMemo(() =>
    props.card
      ? resolveCardImageSources(props.card, Boolean(props.useScryfallImgUrls), props.customArt)
      : null,
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

  const defaultMeta = createMemo((): MetaEntry[] => {
    if (props.meta) return props.meta
    const parts: MetaEntry[] = []
    if (props.card) {
      // A copy wearing custom art is not the printing a price would be for, so
      // the marker stands in for the figure. (The proxy half of the rule needs
      // the entry's labels, which only a caller has — every page that knows them
      // passes its own `meta` and never reaches this default.)
      const marker = cardPricelessMarkerText(t, {
        customArt: props.customArt,
        hasCustomArt: props.hasCustomArt,
      })
      if (pricesEnabled()) {
        const price = sitePrice(props.card, props.currency)
        if (marker !== undefined) parts.push({ label: 'price', value: marker })
        else if (price > 0) {
          parts.push({ label: 'price', value: formatPrice(price, props.currency) })
        }
      }
      parts.push({
        label: 'set',
        value: `${props.card.set_name} (#${props.card.collector_number})`,
      })
      parts.push({
        label: 'rarity',
        value: rarityName(t, props.card.rarity),
      })
    }
    return parts
  })

  const PRINTINGS_PAGE_SIZE = 8

  // Card Kingdom quotes for the printings on show — a no-op on the TCGplayer /
  // Cardmarket views and on a static site, whose details carry them baked. Only
  // while the grid is open: the modal is mounted on every list page.
  const NO_PRINTINGS: readonly ScryfallCard[] = []
  usePrintingQuotes(() => (showPrintings() ? props.printings : NO_PRINTINGS))

  const sortedPrintings = createMemo(() => {
    const dir = printingsSortReversed() ? -1 : 1
    const field = printingsSortField()
    if (field === 'price') {
      // Decorated: a price read is a quote-map lookup under the Card Kingdom
      // source, and a comparator would repeat it O(n log n) times for n distinct
      // values. Source-aware like the figures on the tiles — sorting by
      // TCGplayer while the grid shows Card Kingdom money would order the rows
      // by numbers that are not on screen.
      return props.printings
        .map((printing) => ({ printing, price: printingSortPrice(printing, props.currency) }))
        .sort((a, b) => dir * (b.price - a.price))
        .map((entry) => entry.printing)
    }
    const sorted = [...props.printings]
    sorted.sort((a, b) => {
      switch (field) {
        case 'released_at': {
          const da = a.released_at ?? ''
          const db = b.released_at ?? ''
          return dir * compareData(db, da)
        }
        case 'set_name': {
          const cmp = compareDisplay(a.set_name, b.set_name)
          if (cmp !== 0) return dir * cmp
          const na = parseInt(a.collector_number, 10) || 0
          const nb = parseInt(b.collector_number, 10) || 0
          return dir * (na - nb)
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
          {t('site.cardModal.back')}
        </button>
        <h3>
          {t('site.cardModal.otherPrintingsHeading', {
            name: props.card?.name ?? props.cardName ?? t('site.cardModal.unknownName'),
            count: props.printings.length,
          })}
        </h3>
        <div class="printings-sort-controls">
          <PriceSourceSelect currency={props.currency} id="card-modal-price-source" />
          <select
            class="printings-sort-select"
            value={printingsSortField()}
            onChange={(e) => {
              setPrintingsSortField(e.target.value as PrintingsSortField)
              setPrintingsPage(0)
            }}
          >
            <option value="released_at">{t('site.cardModal.sortReleaseDate')}</option>
            <option value="set_name">{t('site.cardModal.sortSetName')}</option>
            <option value="price">{t('site.cardModal.sortPrice')}</option>
          </select>
          <button
            class="printings-sort-reverse"
            title={
              printingsSortReversed()
                ? t('site.cardModal.sortReversed')
                : t('site.cardModal.sortNormal')
            }
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
            // Alternate-language objects (from an all_cards cache) are badged so
            // two tiles sharing a set:cn are tellable apart. Absent lang = en.
            const pLang = languageBadge(scryfallCardLanguage(p))
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
                    <Show when={pLang}> · {pLang}</Show>
                  </span>
                  <Show when={pricesEnabled()}>
                    {' '}
                    <PrintingPrices
                      printing={p}
                      currency={props.currency}
                      class="printing-label-price"
                    />
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
            {t('site.pagination.prev')}
          </button>
          <span>
            {t('site.pagination.pageOf', {
              page: printingsPage() + 1,
              total: totalPrintingsPages(),
            })}
          </span>
          <button
            disabled={printingsPage() >= totalPrintingsPages() - 1}
            onClick={() => setPrintingsPage(printingsPage() + 1)}
          >
            {t('site.pagination.next')}
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
      aria-label={t('site.cardModal.aria', {
        name: props.card?.name ?? props.cardName ?? t('site.cardModal.unknownCard'),
      })}
    >
      <button class="modal-close" aria-label={t('ui.dialog.close')} onClick={props.onClose}>
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
                        alt={t('site.cardModal.backImageAlt', { name: props.cardName ?? '' })}
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
                    alt={t('site.cardModal.backImageAlt', { name: props.cardName ?? '' })}
                  />
                </div>
              </Show>
              <Show when={isDfc() && imgSources()?.backImage}>
                <button class="flip-btn" onClick={() => setShowingBack((prev) => !prev)}>
                  {t('site.cardModal.flip')}
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
                <div class="modal-note">{t('site.cardModal.note', { note: props.note ?? '' })}</div>
              </Show>
              <div class="modal-actions">
                <Show when={scryfallUrl()}>
                  {(url) => (
                    <a href={url()} target="_blank" rel="noopener noreferrer">
                      {t('site.cardModal.viewOnScryfall')}
                    </a>
                  )}
                </Show>
                <Show when={props.printings.length > 0}>
                  <button onClick={() => setShowPrintings(true)}>
                    {t('site.cardModal.otherPrintingsButton', { count: props.printings.length })}
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
                      {t('site.cardModal.findInLists')}
                    </button>
                  )}
                </Show>
                <Show when={props.card}>
                  <button aria-expanded={showTags()} onClick={() => setShowTags((prev) => !prev)}>
                    {t('site.cardModal.tags')} {showTags() ? '▾' : '▸'}
                  </button>
                </Show>
                <Show when={props.onAddToTrade !== undefined}>
                  <button
                    onClick={props.onAddToTrade}
                    disabled={props.addToTradeDisabled}
                    title={
                      props.addToTradeDisabled
                        ? t('site.card.atMaxQuantity')
                        : t('site.card.addToTrade')
                    }
                  >
                    {t('site.cardModal.addToTrade')}
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
                      <span>{t('site.cardModal.noTagData')}</span>
                    </div>
                  }
                >
                  <div class="modal-tags">
                    <Show when={oracleTags().length > 0}>
                      <div class="modal-tags-group">
                        <span class="modal-tags-label">{t('site.cardModal.oracleTags')}</span>
                        <div class="modal-tags-list">
                          <For each={oracleTags()}>
                            {(tag) => <span class="modal-tag">{tag}</span>}
                          </For>
                        </div>
                      </div>
                    </Show>
                    <Show when={artTags().length > 0}>
                      <div class="modal-tags-group">
                        <span class="modal-tags-label">{t('site.cardModal.artTags')}</span>
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
