import type { Accessor, Component } from 'solid-js'
import { createSignal, createMemo, For, Show, onCleanup, createEffect, onMount } from 'solid-js'
import type { ScryfallCard, Finish } from '../types'
import type { PriceCurrency } from '../price-currency'
import { normalizeCardName } from '../term-match'
import { useT } from '../ui/i18n'
import type { TranslateFn } from '../i18n/t'
import { formatPrice, getCardPriceForFinish } from '../price-currency'
import type {
  TradeCardEntry,
  TradeCardSource,
  CollectionSummary,
  DeckSummary,
  WantedListSummary,
} from './data-types'
import { TradeColumn } from './TradeColumn'
import type { AutocompleteItem, TradeColumnMode, TradeColumnModeControl } from './TradeColumn'
import { TradePrintingPicker } from './TradePrintingPicker'
import { useTradeData } from './useTradeData'
import type { TradeSearchEntry } from './useTradeData'
import { useCardSearch } from './useCardSearch'
import { encodeTradeToParams, hasTradeParams } from './trade-url-encode'
import { decodeTradeFromParams } from './trade-url-decode'
import type { TradeDecodeWarning } from './trade-url-decode'
import { resolveTradeFinish } from './trade-finish'
import { hasSpecificPrinting } from '../card-printing'
import { batchFetchScryfall } from './scryfall-collection'
import { batchFetchApiPrices } from './api-prices'
import { apiActive } from './api-base'
import { cardLookupSourceName } from './card-lookup'
import { printingKey } from '../printing-key'
import type { TradeSortBy, TradeSortState } from './trade-sort'
import { useTooltip } from './useTooltip'
import type { UseTooltipResult } from './useTooltip'
import {
  leftCards,
  setLeftCards,
  rightCards,
  setRightCards,
  addEntryToLeft,
  addEntryToLeftGuarded,
  addEntryToRight,
  isAlreadyInLeftList,
  isAlreadyInRightList,
  tradePrice,
} from './useTradeState'
import { useStuck } from './useStuck'

/**
 * Render one decode warning. Takes the translator rather than reaching for the
 * module-level `t`, so the list re-renders in the new language when the locale
 * switches.
 */
function formatDecodeWarning(t: TranslateFn, w: TradeDecodeWarning): string {
  switch (w.kind) {
    case 'unknown-source':
      return t('site.trade.unknownSource', {
        sourceKind: w.sourceKind,
        sourceName: w.sourceName,
      })
    case 'unknown-card-ids':
      return t('site.trade.unknownCardIds', {
        count: w.ids.length,
        ids: w.ids.join(', '),
        sourceKind: w.sourceKind,
        sourceName: w.sourceName,
      })
    case 'unknown-scryfall-id':
      return t('site.trade.unknownScryfallId', { id: w.sfId })
    case 'malformed-token':
      return t('site.trade.malformedToken', { token: w.token })
  }
}

interface PickerState {
  cardName: string
  side: 'left' | 'right'
  source: TradeCardSource
  sourceName: string
  /**
   * The list entry being added, when the pick comes from one. Everything the
   * row needs beyond the chosen printing (condition, note, quantity cap, card
   * IDs) is carried through from here rather than re-spelled field by field.
   */
  entry?: TradeSearchEntry
  /** Original-array index of the row being edited; absent when adding a new row. */
  editIndex?: number
  /** `set:collectorNumber` keys a wanted list asks for, marked in the picker. */
  desiredPrintings?: string[]
}

interface TradePageProps {
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  collections: Accessor<CollectionSummary[] | null>
  decks: Accessor<DeckSummary[] | null>
  wantedLists: Accessor<WantedListSummary[] | null>
}

export const TradePage: Component<TradePageProps> = (props) => {
  const t = useT()
  const tradeData = useTradeData({
    collections: () => props.collections(),
    decks: () => props.decks(),
    wantedLists: () => props.wantedLists(),
  })
  const cardSearch = useCardSearch()

  const [leftSort, setLeftSort] = createSignal<TradeSortState>({ by: 'name', reverse: false })
  const [leftQuery, setLeftQuery] = createSignal('')
  const [includeDecks, setIncludeDecks] = createSignal(false)

  const [rightSort, setRightSort] = createSignal<TradeSortState>({ by: 'name', reverse: false })
  const [rightQuery, setRightQuery] = createSignal('')
  const [scryfallMode, setScryfallMode] = createSignal(false)

  /**
   * What the right column's search box covers. A live backend answers card
   * search from its own card cache, which holds every card — not just the ones
   * your lists mention — so the column searches the wanted lists and that cache
   * together and drops the Scryfall toggle, whose only purpose was reaching
   * cards no list holds. Without a backend the toggle stays and switches between
   * the wanted lists and Scryfall. Reactive on `apiActive`, so a remote backend
   * that degrades mid-session hands the toggle back.
   */
  const rightMode = createMemo((): TradeColumnMode => {
    if (apiActive()) return 'wanted-cache'
    return scryfallMode() ? 'scryfall' : 'wanted'
  })

  /** True while the right column's query is also sent to the card-search backend. */
  const rightSearchesCards = createMemo(() => rightMode() !== 'wanted')

  const [picker, setPicker] = createSignal<PickerState | null>(null)
  const [activePane, setActivePane] = createSignal<'left' | 'right'>('left')
  const tooltip: UseTooltipResult = useTooltip()
  /**
   * URL-decode lifecycle.
   * - `idle`: no trade params seen yet (or no params present at mount).
   * - `pending`: params detected on mount; waiting for `initialReady` (and `decksReady`
   *   if leftSideDeckIds is present) before invoking decode.
   * - `applied`: decode has run; effect should not fire again.
   */
  type DecodeStatus = 'idle' | 'pending' | 'applied'
  const [decodeStatus, setDecodeStatus] = createSignal<DecodeStatus>('idle')
  const [decodeWarnings, setDecodeWarnings] = createSignal<TradeDecodeWarning[]>([])
  type CopyToast = { message: string; x: number; y: number }
  const [copyToast, setCopyToast] = createSignal<CopyToast | null>(null)
  let copyToastTimer: ReturnType<typeof setTimeout> | null = null
  let copyButtonRef: HTMLButtonElement | undefined
  let updatePricesButtonRef: HTMLButtonElement | undefined
  const [resetConfirmOpen, setResetConfirmOpen] = createSignal(false)
  const [updatingPrices, setUpdatingPrices] = createSignal(false)
  const { stuck: primaryToolbarStuck, sentinelRef: primaryToolbarSentinelRef } = useStuck()

  const repriceForCurrency = (
    cards: TradeCardEntry[],
    currency: PriceCurrency,
  ): TradeCardEntry[] => {
    let changed = false
    const next = cards.map((c) => {
      if (!c.scryfallCard) return c
      const finish = resolveTradeFinish(c.scryfallCard, c.finish)
      const price = tradePrice(c, () => getCardPriceForFinish(c.scryfallCard!, finish, currency))
      if (price === c.price && finish === c.finish) return c
      changed = true
      return { ...c, price, finish }
    })
    return changed ? next : cards
  }

  createEffect(() => {
    const currency = props.currency
    setLeftCards((prev) => repriceForCurrency(prev, currency))
    setRightCards((prev) => repriceForCurrency(prev, currency))
  })

  onCleanup(() => {
    if (copyToastTimer !== null) clearTimeout(copyToastTimer)
  })

  createEffect(() => {
    if (includeDecks()) {
      tradeData.loadDecks()
    }
  })

  const leftTotal = createMemo(() => leftCards().reduce((s, c) => s + (c.price ?? 0) * c.qty, 0))
  const rightTotal = createMemo(() => rightCards().reduce((s, c) => s + (c.price ?? 0) * c.qty, 0))
  const leftCount = createMemo(() => leftCards().reduce((s, c) => s + c.qty, 0))
  const rightCount = createMemo(() => rightCards().reduce((s, c) => s + c.qty, 0))
  const balance = createMemo(() => rightTotal() - leftTotal())
  const balanceTone = createMemo((): 'positive' | 'negative' | 'neutral' => {
    const b = balance()
    if (Math.abs(b) < 0.01) return 'neutral'
    return b > 0 ? 'positive' : 'negative'
  })

  const leftAutocompleteItems = createMemo((): AutocompleteItem[] => {
    const q = leftQuery()
    if (q.length < 2) return []
    return tradeData
      .searchLeft(q, includeDecks())
      .filter((entry) => !isAlreadyInLeftList(entry))
      .map((entry): AutocompleteItem => ({ kind: 'local', entry }))
  })

  // Wanted-list matches lead: they carry a source, printing and price, and are
  // ready the moment they're typed. Card-search names follow once they land.
  // A card both halves know about is listed twice on purpose — the wanted row
  // adds the copy that list asked for, the card-search row any other printing.
  const rightAutocompleteItems = createMemo((): AutocompleteItem[] => {
    const mode = rightMode()
    const wanted =
      mode === 'scryfall'
        ? []
        : tradeData
            .searchWanted(rightQuery())
            .filter((entry) => !isAlreadyInRightList(entry))
            .map((entry): AutocompleteItem => ({ kind: 'local', entry }))
    const cards = rightSearchesCards()
      ? cardSearch.autocompleteResults().map((name): AutocompleteItem => ({ kind: 'search', name }))
      : []
    return [...wanted, ...cards]
  })

  const rightAutocompleteLoading = createMemo(() => {
    const wanted = rightMode() !== 'scryfall' && tradeData.loadingWanted()
    return wanted || (rightSearchesCards() && cardSearch.autocompleteLoading())
  })

  const handleScryfallModeChange = () => {
    setScryfallMode((prev) => !prev)
    cardSearch.clearAutocomplete()
    setRightQuery('')
  }

  const rightModeControl = createMemo((): TradeColumnModeControl => {
    if (rightMode() === 'wanted-cache') {
      return { kind: 'note', text: t('site.trade.cacheNote') }
    }
    return {
      kind: 'toggle',
      label: t('site.trade.searchScryfall'),
      active: scryfallMode(),
      onChange: handleScryfallModeChange,
    }
  })

  const handleLeftSearchInput = (q: string) => {
    setLeftQuery(q)
  }

  const handleRightSearchInput = (q: string) => {
    setRightQuery(q)
    if (rightSearchesCards()) {
      cardSearch.fetchAutocomplete(q)
    }
  }

  const handleLeftSelect = (item: AutocompleteItem) => {
    if (item.kind !== 'local') return
    const entry = item.entry
    if (entry.sourceKind === 'deck' && !hasSpecificPrinting(entry)) {
      setPicker({
        cardName: entry.name,
        side: 'left',
        source: 'deck',
        sourceName: entry.sourceName,
        entry,
      })
      void cardSearch.fetchPrintings(entry.name)
      return
    }
    // Guarded: a keep-labeled collection entry confirms once before adding.
    // (Deck entries reach here too, but never carry labels, so they pass through.)
    void addEntryToLeftGuarded(entry, props.currency)
  }

  /** Every printing any wanted list asks for under this card name. */
  const desiredPrintingsFor = (nameKey: string): string[] => {
    const keys = new Set<string>()
    for (const entry of tradeData.wantedEntries()) {
      if (entry.nameKey !== nameKey) continue
      if (hasSpecificPrinting(entry)) keys.add(printingKey(entry.set, entry.collectorNumber))
    }
    return [...keys]
  }

  const handleRightSelect = (item: AutocompleteItem) => {
    if (item.kind === 'local') {
      // A wanted list records the printing you'd *like*, not the one being
      // offered, so it never picks for you — the picker opens with whatever the
      // list asked for marked, and the trader confirms what's actually on offer.
      const entry = item.entry
      setPicker({
        cardName: entry.name,
        side: 'right',
        source: 'wanted',
        sourceName: entry.sourceName,
        entry,
        desiredPrintings: desiredPrintingsFor(entry.nameKey),
      })
      void cardSearch.fetchPrintings(entry.name)
    } else {
      // A bare card name belongs to no list of yours: it becomes a Scryfall-sourced
      // row (encoded by Scryfall ID in the trade URL) whichever backend found it.
      setPicker({
        cardName: item.name,
        side: 'right',
        source: 'scryfall',
        sourceName: cardLookupSourceName(),
      })
      void cardSearch.fetchPrintings(item.name)
    }
  }

  const handlePickerSelect = (printing: ScryfallCard, finish: Finish) => {
    const p = picker()
    if (!p) return
    const price = getCardPriceForFinish(printing, finish, props.currency)

    if (p.editIndex !== undefined) {
      const setter = p.side === 'left' ? setLeftCards : setRightCards
      setter((prev) =>
        prev.map((c, i) =>
          i === p.editIndex
            ? {
                ...c,
                name: printing.name,
                set: printing.set,
                collectorNumber: printing.collector_number,
                finish,
                scryfallCard: printing,
                // Re-picking the printing does not make a proxy real, nor undo a
                // copy's custom art: the row keeps both, and with them its price.
                price: tradePrice(c, () => price),
              }
            : c,
        ),
      )
    } else if (p.entry) {
      // Route through addEntry so the card-ID-based deduplication cap is
      // enforced, and so the entry's own condition/note reach the row — they
      // take part in the dedup, and a note is what keeps two otherwise
      // identical wanted entries apart.
      const searchEntry: TradeSearchEntry = {
        ...p.entry,
        name: printing.name,
        nameKey: normalizeCardName(printing.name),
        set: printing.set.toLowerCase(),
        collectorNumber: printing.collector_number,
        finish,
        scryfallCard: printing,
        editable: true,
      }
      // Unguarded on purpose: the left picker only ever opens for name-only
      // *deck* entries, which never carry labels — the keep guard is a
      // collection concern handled in handleLeftSelect.
      if (p.side === 'left') addEntryToLeft(searchEntry, props.currency)
      else addEntryToRight(searchEntry, props.currency)
    } else {
      // Belongs to no list — add directly, no source cap.
      const setter = p.side === 'left' ? setLeftCards : setRightCards
      setter((prev) => [
        ...prev,
        {
          name: printing.name,
          set: printing.set,
          collectorNumber: printing.collector_number,
          finish,
          scryfallCard: printing,
          price,
          source: p.source,
          sourceName: p.sourceName,
          qty: 1,
          editable: true,
        },
      ])
    }

    if (p.editIndex === undefined) {
      if (p.side === 'left') setLeftQuery('')
      else setRightQuery('')
    }
    setPicker(null)
    cardSearch.clearPrintings()
    cardSearch.clearAutocomplete()
  }

  type Side = 'left' | 'right'
  const setterFor = (side: Side) => (side === 'left' ? setLeftCards : setRightCards)
  const setSortFor = (side: Side) => (side === 'left' ? setLeftSort : setRightSort)

  const handleSort = (side: Side, by: TradeSortBy) => {
    setSortFor(side)((prev) => ({ by, reverse: prev.by === by ? prev.reverse : false }))
  }

  const handleRemove = (side: Side, card: TradeCardEntry) => {
    setterFor(side)((prev) => prev.filter((c) => c !== card))
    handleTooltipLeave()
  }

  const openEditPicker = (side: Side, card: TradeCardEntry) => {
    if (!card.editable) return
    const cards = side === 'left' ? leftCards() : rightCards()
    const editIndex = cards.indexOf(card)
    if (editIndex < 0) return
    setPicker({
      cardName: card.name,
      side,
      source: card.source,
      sourceName: card.sourceName,
      editIndex,
      // Re-editing a wanted row marks the same printings the add path did.
      desiredPrintings:
        card.source === 'wanted' ? desiredPrintingsFor(normalizeCardName(card.name)) : undefined,
    })
    void cardSearch.fetchPrintings(card.name)
  }

  const clampQty = (card: TradeCardEntry, delta: number): number => {
    const cap = card.maxQty ?? Infinity
    return Math.min(cap, Math.max(1, card.qty + delta))
  }

  const handleUpdateQty = (side: Side, card: TradeCardEntry, delta: number) => {
    setterFor(side)((prev) => prev.map((c) => (c === card ? { ...c, qty: clampQty(c, delta) } : c)))
  }

  const handleTooltipEnter = (src: string, sideways: boolean) => {
    tooltip.setTooltip({ src, sideways })
  }

  const handleTooltipLeave = () => {
    tooltip.setTooltip(null)
  }

  const getHashParams = (): URLSearchParams => {
    const hash = window.location.hash
    const qIdx = hash.indexOf('?')
    return qIdx >= 0 ? new URLSearchParams(hash.slice(qIdx + 1)) : new URLSearchParams()
  }

  const tradeBase = () => `${window.location.origin}${window.location.pathname}#/trade`

  const handleResetRequest = () => {
    if (leftCards().length === 0 && rightCards().length === 0) return
    setResetConfirmOpen(true)
  }

  const handleResetConfirm = () => {
    setLeftCards([])
    setRightCards([])
    window.history.replaceState({}, '', tradeBase())
    setResetConfirmOpen(false)
  }

  createEffect(() => {
    if (!resetConfirmOpen()) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setResetConfirmOpen(false)
    }
    document.addEventListener('keydown', handler)
    onCleanup(() => document.removeEventListener('keydown', handler))
  })

  const showToast = (message: string, anchor?: HTMLElement) => {
    const rect = anchor?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const y = rect ? rect.top - 6 : 24
    setCopyToast({ message, x, y })
    if (copyToastTimer !== null) clearTimeout(copyToastTimer)
    copyToastTimer = setTimeout(() => {
      setCopyToast(null)
      copyToastTimer = null
    }, 5000)
  }

  const handleCopyLink = () => {
    const params = encodeTradeToParams(leftCards(), rightCards())
    const urlStr =
      params.toString().length > 0 ? `${tradeBase()}?${params.toString()}` : tradeBase()
    window.history.replaceState({}, '', urlStr)
    void navigator.clipboard.writeText(urlStr).then(
      () => showToast(t('site.trade.linkCopied'), copyButtonRef),
      () => showToast(t('site.trade.linkCopyFailed'), copyButtonRef),
    )
  }

  const repriceWithUpdatedCards = (
    cards: TradeCardEntry[],
    updated: Map<string, ScryfallCard>,
  ): TradeCardEntry[] => {
    let changed = false
    const next = cards.map((c) => {
      const fresh = c.scryfallCard ? updated.get(c.scryfallCard.id) : undefined
      if (!fresh) return c
      const finish = resolveTradeFinish(fresh, c.finish)
      const price = tradePrice(c, () => getCardPriceForFinish(fresh, finish, props.currency))
      changed = true
      return { ...c, scryfallCard: fresh, finish, price }
    })
    return changed ? next : cards
  }

  // Live backend: fetch by name through the API's batch price endpoint, then
  // key the result back by id for repricing. Static: id-batched Scryfall.
  const fetchUpdatedCards = async (
    entries: TradeCardEntry[],
  ): Promise<Map<string, ScryfallCard>> => {
    if (apiActive()) {
      const names = new Set<string>()
      for (const c of entries) if (c.scryfallCard) names.add(c.scryfallCard.name)
      const cards = await batchFetchApiPrices([...names])
      return new Map(cards.map((card) => [card.id, card]))
    }
    const ids = new Set<string>()
    for (const c of entries) if (c.scryfallCard) ids.add(c.scryfallCard.id)
    return batchFetchScryfall([...ids])
  }

  const handleUpdatePrices = async () => {
    if (updatingPrices()) return
    const entries = [...leftCards(), ...rightCards()]
    if (!entries.some((c) => c.scryfallCard)) {
      showToast(t('site.trade.noCardsToUpdate'), updatePricesButtonRef)
      return
    }
    setUpdatingPrices(true)
    try {
      const updated = await fetchUpdatedCards(entries)
      if (updated.size === 0) {
        showToast(t('site.trade.priceUpdateFailed'), updatePricesButtonRef)
        return
      }
      setLeftCards((prev) => repriceWithUpdatedCards(prev, updated))
      setRightCards((prev) => repriceWithUpdatedCards(prev, updated))
      showToast(t('site.trade.pricesUpdated', { count: updated.size }), updatePricesButtonRef)
    } finally {
      setUpdatingPrices(false)
    }
  }

  onMount(() => {
    const params = getHashParams()
    if (!hasTradeParams(params)) return
    if (params.has('leftSideDeckIds')) {
      tradeData.loadDecks()
    }
    setDecodeStatus('pending')
  })

  createEffect(() => {
    if (decodeStatus() !== 'pending') return
    if (!tradeData.initialReady()) return
    const params = getHashParams()
    if (params.has('leftSideDeckIds') && !tradeData.decksReady()) return

    setDecodeStatus('applied')
    void decodeTradeFromParams(
      params,
      {
        collectionEntries: tradeData.collectionEntries(),
        deckEntries: tradeData.deckEntries(),
        wantedEntries: tradeData.wantedEntries(),
      },
      props.currency,
    ).then((decoded) => {
      if (decoded.left.length > 0) setLeftCards(decoded.left)
      if (decoded.right.length > 0) setRightCards(decoded.right)
      if (decoded.warnings.length > 0) setDecodeWarnings(decoded.warnings)
    })
  })

  return (
    <div class="trade-page">
      <div class="page-header">
        <h1 class="page-title">{t('site.trade.title')}</h1>
      </div>

      <div ref={primaryToolbarSentinelRef} aria-hidden="true" class="toolbar-sentinel" />
      <div class="primary-toolbar" classList={{ 'is-stuck': primaryToolbarStuck() }}>
        <div class="primary-toolbar-left">
          <button
            ref={updatePricesButtonRef}
            class="btn btn-primary"
            onClick={() => void handleUpdatePrices()}
            disabled={updatingPrices()}
          >
            {updatingPrices() ? t('site.trade.updatingPrices') : t('site.trade.updatePrices')}
          </button>
          <button class="btn btn-secondary" onClick={handleResetRequest}>
            {t('site.trade.reset')}
          </button>
          <span class="primary-toolbar-sep" />
          <button ref={copyButtonRef} class="btn btn-secondary" onClick={handleCopyLink}>
            {t('site.trade.copyLink')}
          </button>
        </div>
        <div class="primary-toolbar-right">
          <span class="trade-summary-side">
            <span class="trade-summary-count">{t('ui.count.cards', { count: leftCount() })}</span>
            <span style="color: var(--text-dim)">·</span>
            <span class="trade-summary-price">{formatPrice(leftTotal(), props.currency)}</span>
          </span>
          <span class="primary-toolbar-arrow">→</span>
          <span class="trade-summary-side">
            <span class="trade-summary-price">{formatPrice(rightTotal(), props.currency)}</span>
            <span style="color: var(--text-dim)">·</span>
            <span class="trade-summary-count">{t('ui.count.cards', { count: rightCount() })}</span>
          </span>
          <span class="primary-toolbar-sep" />
          <span class="primary-toolbar-balance">
            <span class="trade-summary-balance-label">{t('site.trade.difference')}</span>
            <span class={`trade-summary-balance-value ${balanceTone()}`}>
              {balance() >= 0 ? '+' : '−'}
              {formatPrice(Math.abs(balance()), props.currency)}
            </span>
          </span>
        </div>
      </div>

      <Show when={decodeWarnings().length > 0}>
        <div class="trade-decode-warnings" role="status" aria-live="polite">
          <div class="trade-decode-warnings-head">
            <strong>{t('site.trade.decodeWarningsHead')}</strong>
            <button
              class="trade-decode-warnings-dismiss"
              onClick={() => setDecodeWarnings([])}
              aria-label={t('site.trade.dismissWarnings')}
            >
              ×
            </button>
          </div>
          <ul class="trade-decode-warnings-list">
            <For each={decodeWarnings()}>{(w) => <li>{formatDecodeWarning(t, w)}</li>}</For>
          </ul>
        </div>
      </Show>

      <div class="col-toggle">
        <button
          classList={{ active: activePane() === 'left' }}
          onClick={() => setActivePane('left')}
        >
          {t('site.trade.offering')}
          <span class="col-toggle-meta">
            {leftCount()} · {formatPrice(leftTotal(), props.currency)}
          </span>
        </button>
        <button
          classList={{ active: activePane() === 'right' }}
          onClick={() => setActivePane('right')}
        >
          {t('site.trade.receiving')}
          <span class="col-toggle-meta">
            {rightCount()} · {formatPrice(rightTotal(), props.currency)}
          </span>
        </button>
      </div>

      <div class="trade-columns">
        <TradeColumn
          side="left"
          cards={leftCards()}
          sort={leftSort()}
          currency={props.currency}
          useScryfallImgUrls={props.useScryfallImgUrls}
          onSortChange={(by) => handleSort('left', by)}
          onReverseToggle={() => setLeftSort((prev) => ({ ...prev, reverse: !prev.reverse }))}
          onRemove={(card) => handleRemove('left', card)}
          onUpdateQty={(card, delta) => handleUpdateQty('left', card, delta)}
          onEdit={(card) => openEditPicker('left', card)}
          searchQuery={leftQuery()}
          onSearchInput={handleLeftSearchInput}
          autocompleteItems={leftAutocompleteItems()}
          autocompleteLoading={tradeData.loadingCollections()}
          onAutocompleteSelect={handleLeftSelect}
          mode={includeDecks() ? 'collection-decks' : 'collection'}
          modeControl={{
            kind: 'toggle',
            label: t('site.trade.includeDecks'),
            active: includeDecks(),
            onChange: () => setIncludeDecks((prev) => !prev),
          }}
          hidden={activePane() === 'right'}
          onTooltipEnter={handleTooltipEnter}
          onTooltipLeave={handleTooltipLeave}
        />
        <TradeColumn
          side="right"
          cards={rightCards()}
          sort={rightSort()}
          currency={props.currency}
          useScryfallImgUrls={props.useScryfallImgUrls}
          onSortChange={(by) => handleSort('right', by)}
          onReverseToggle={() => setRightSort((prev) => ({ ...prev, reverse: !prev.reverse }))}
          onRemove={(card) => handleRemove('right', card)}
          onUpdateQty={(card, delta) => handleUpdateQty('right', card, delta)}
          onEdit={(card) => openEditPicker('right', card)}
          searchQuery={rightQuery()}
          onSearchInput={handleRightSearchInput}
          autocompleteItems={rightAutocompleteItems()}
          autocompleteLoading={rightAutocompleteLoading()}
          onAutocompleteSelect={handleRightSelect}
          mode={rightMode()}
          modeControl={rightModeControl()}
          hidden={activePane() === 'left'}
          onTooltipEnter={handleTooltipEnter}
          onTooltipLeave={handleTooltipLeave}
        />
      </div>

      <Show when={resetConfirmOpen()}>
        <div class="trade-picker-overlay" onClick={() => setResetConfirmOpen(false)}>
          <div
            class="trade-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trade-reset-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="trade-reset-title" class="trade-confirm-title">
              {t('site.trade.clearTitle')}
            </h3>
            <p class="trade-confirm-message">{t('site.trade.clearMessage')}</p>
            <div class="trade-confirm-actions">
              <button class="btn btn-secondary" onClick={() => setResetConfirmOpen(false)}>
                {t('ui.dialog.cancel')}
              </button>
              <button class="btn btn-danger" onClick={handleResetConfirm}>
                {t('site.trade.clearConfirm')}
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={picker()}>
        {(p) => (
          <TradePrintingPicker
            cardName={p().cardName}
            printings={cardSearch.printings()}
            desiredPrintings={p().desiredPrintings}
            loading={cardSearch.printingsLoading()}
            useScryfallImgUrls={props.useScryfallImgUrls}
            currency={props.currency}
            onSelect={handlePickerSelect}
            onClose={() => {
              setPicker(null)
              cardSearch.clearPrintings()
            }}
          />
        )}
      </Show>

      <div
        ref={tooltip.tooltipRef}
        class={`list-tooltip ${tooltip.tooltip() ? 'visible' : ''} ${tooltip.tooltip()?.sideways ? 'list-tooltip-sideways' : ''}`}
        style={`left:${tooltip.tooltipPos().left}px;top:${tooltip.tooltipPos().top}px;`}
      >
        <Show when={tooltip.tooltip()}>
          <img
            src={tooltip.tooltip()!.src}
            alt=""
            class={tooltip.tooltip()!.sideways ? 'tooltip-rotated' : ''}
            onError={() => tooltip.setTooltip(null)}
          />
        </Show>
      </div>

      <Show when={copyToast()}>
        {(toast) => (
          <div class="trade-copy-toast" style={{ left: `${toast().x}px`, top: `${toast().y}px` }}>
            {toast().message}
          </div>
        )}
      </Show>
    </div>
  )
}
