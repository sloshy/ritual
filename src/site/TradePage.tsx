import type { Accessor, Component } from 'solid-js'
import { createSignal, createMemo, For, Show, onCleanup, createEffect, onMount } from 'solid-js'
import type { ScryfallCard, Finish } from '../types'
import type { PriceCurrency } from '../price-currency'
import { normalizeCardName } from '../term-match'
import { formatPrice, getCardPriceForFinish } from '../price-currency'
import type {
  TradeCardEntry,
  TradeCardSource,
  CollectionSummary,
  DeckSummary,
  WantedListSummary,
} from './data-types'
import { TradeColumn } from './TradeColumn'
import type { AutocompleteItem } from './TradeColumn'
import { TradePrintingPicker } from './TradePrintingPicker'
import { useTradeData } from './useTradeData'
import type { TradeSearchEntry } from './useTradeData'
import { useScryfallBrowserSearch } from './useScryfallBrowserSearch'
import { encodeTradeToParams, hasTradeParams } from './trade-url-encode'
import { decodeTradeFromParams } from './trade-url-decode'
import type { TradeDecodeWarning } from './trade-url-decode'
import { resolveTradeFinish } from './trade-finish'
import { hasSpecificPrinting } from '../card-printing'
import { batchFetchScryfall } from './scryfall-collection'
import type { TradeSortBy, TradeSortState } from './trade-sort'
import { useTooltip } from './useTooltip'
import type { UseTooltipResult } from './useTooltip'
import {
  leftCards,
  setLeftCards,
  rightCards,
  setRightCards,
  addEntryToLeft,
  addEntryToRight,
  isAlreadyInLeftList,
  isAlreadyInRightList,
} from './useTradeState'
import { useStuck } from './useStuck'

function formatDecodeWarning(w: TradeDecodeWarning): string {
  switch (w.kind) {
    case 'unknown-source':
      return `${w.sourceKind} "${w.sourceName}" was not found.`
    case 'unknown-card-ids':
      return `Card${w.ids.length > 1 ? 's' : ''} with ID${w.ids.length > 1 ? 's' : ''} ${w.ids.join(', ')} not found in ${w.sourceKind} "${w.sourceName}".`
    case 'unknown-scryfall-id':
      return `Scryfall card "${w.sfId}" could not be loaded.`
    case 'malformed-token':
      return `Could not parse trade URL token "${w.token}".`
  }
}

interface PickerState {
  cardName: string
  side: 'left' | 'right'
  source: TradeCardSource
  sourceName: string
  maxQty?: number
  sourceCardIds?: number[]
  /** Original-array index of the row being edited; absent when adding a new row. */
  editIndex?: number
}

interface TradePageProps {
  useScryfallImgUrls?: boolean
  currency: PriceCurrency
  collections: Accessor<CollectionSummary[] | null>
  decks: Accessor<DeckSummary[] | null>
  wantedLists: Accessor<WantedListSummary[] | null>
}

export const TradePage: Component<TradePageProps> = (props) => {
  const tradeData = useTradeData({
    collections: () => props.collections(),
    decks: () => props.decks(),
    wantedLists: () => props.wantedLists(),
  })
  const scryfallSearch = useScryfallBrowserSearch()

  const [leftSort, setLeftSort] = createSignal<TradeSortState>({ by: 'name', reverse: false })
  const [leftQuery, setLeftQuery] = createSignal('')
  const [includeDecks, setIncludeDecks] = createSignal(false)

  const [rightSort, setRightSort] = createSignal<TradeSortState>({ by: 'name', reverse: false })
  const [rightQuery, setRightQuery] = createSignal('')
  const [scryfallMode, setScryfallMode] = createSignal(false)

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
      const price = getCardPriceForFinish(c.scryfallCard, finish, currency)
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

  const rightAutocompleteItems = createMemo((): AutocompleteItem[] => {
    if (scryfallMode()) {
      return scryfallSearch
        .autocompleteResults()
        .map((name): AutocompleteItem => ({ kind: 'scryfall', name }))
    }
    const q = rightQuery()
    if (q.length < 2) return []
    return tradeData
      .searchWanted(q)
      .filter((entry) => !isAlreadyInRightList(entry))
      .map((entry): AutocompleteItem => ({ kind: 'local', entry }))
  })

  const handleLeftSearchInput = (q: string) => {
    setLeftQuery(q)
  }

  const handleRightSearchInput = (q: string) => {
    setRightQuery(q)
    if (scryfallMode()) {
      scryfallSearch.fetchAutocomplete(q)
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
        maxQty: entry.maxQty,
        sourceCardIds: entry.cardIds,
      })
      void scryfallSearch.fetchPrintings(entry.name)
      return
    }
    addEntryToLeft(entry, props.currency)
  }

  const handleRightSelect = (item: AutocompleteItem) => {
    if (item.kind === 'local') {
      addEntryToRight(item.entry, props.currency)
    } else if (item.kind === 'scryfall') {
      setPicker({
        cardName: item.name,
        side: 'right',
        source: 'scryfall',
        sourceName: 'Scryfall',
      })
      void scryfallSearch.fetchPrintings(item.name)
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
                price,
              }
            : c,
        ),
      )
    } else if (p.source === 'collection' || p.source === 'deck' || p.source === 'wanted') {
      // Route through addEntry so the card-ID-based deduplication cap is enforced.
      const searchEntry: TradeSearchEntry = {
        name: printing.name,
        nameKey: normalizeCardName(printing.name),
        set: printing.set.toLowerCase(),
        collectorNumber: printing.collector_number,
        finish,
        scryfallCard: printing,
        sourceName: p.sourceName,
        sourceKind: p.source,
        maxQty: p.maxQty ?? 1,
        cardIds: p.sourceCardIds ?? [],
        editable: true,
      }
      if (p.side === 'left') addEntryToLeft(searchEntry, props.currency)
      else addEntryToRight(searchEntry, props.currency)
    } else {
      // Scryfall source — add directly, no source cap.
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
          maxQty: p.maxQty,
          editable: true,
          sourceCardIds: p.sourceCardIds,
        },
      ])
    }

    if (p.editIndex === undefined) {
      if (p.side === 'left') setLeftQuery('')
      else setRightQuery('')
    }
    setPicker(null)
    scryfallSearch.clearPrintings()
    scryfallSearch.clearAutocomplete()
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
      maxQty: card.maxQty,
      editIndex,
    })
    void scryfallSearch.fetchPrintings(card.name)
  }

  const clampQty = (card: TradeCardEntry, delta: number): number => {
    const cap = card.maxQty ?? Infinity
    return Math.min(cap, Math.max(1, card.qty + delta))
  }

  const handleUpdateQty = (side: Side, card: TradeCardEntry, delta: number) => {
    setterFor(side)((prev) => prev.map((c) => (c === card ? { ...c, qty: clampQty(c, delta) } : c)))
  }

  const handleScryfallModeChange = () => {
    setScryfallMode((prev) => !prev)
    scryfallSearch.clearAutocomplete()
    setRightQuery('')
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
      () => showToast('Link copied to clipboard', copyButtonRef),
      () => showToast('Could not copy — link is in the address bar', copyButtonRef),
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
      const price = getCardPriceForFinish(fresh, finish, props.currency)
      changed = true
      return { ...c, scryfallCard: fresh, finish, price }
    })
    return changed ? next : cards
  }

  const handleUpdatePrices = async () => {
    if (updatingPrices()) return
    const ids = new Set<string>()
    for (const c of leftCards()) if (c.scryfallCard) ids.add(c.scryfallCard.id)
    for (const c of rightCards()) if (c.scryfallCard) ids.add(c.scryfallCard.id)
    if (ids.size === 0) {
      showToast('No cards to update', updatePricesButtonRef)
      return
    }
    setUpdatingPrices(true)
    try {
      const updated = await batchFetchScryfall([...ids])
      if (updated.size === 0) {
        showToast('Could not update prices', updatePricesButtonRef)
        return
      }
      setLeftCards((prev) => repriceWithUpdatedCards(prev, updated))
      setRightCards((prev) => repriceWithUpdatedCards(prev, updated))
      const noun = updated.size === 1 ? 'card' : 'cards'
      showToast(`Updated prices for ${updated.size} ${noun}`, updatePricesButtonRef)
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
        <h1 class="page-title">Trade Editor</h1>
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
            {updatingPrices() ? '↻ Updating…' : '↻ Update prices'}
          </button>
          <button class="btn btn-secondary" onClick={handleResetRequest}>
            Reset
          </button>
          <span class="primary-toolbar-sep" />
          <button ref={copyButtonRef} class="btn btn-secondary" onClick={handleCopyLink}>
            Copy Link
          </button>
        </div>
        <div class="primary-toolbar-right">
          <span class="trade-summary-side">
            <span class="trade-summary-count">
              {leftCount()} {leftCount() === 1 ? 'card' : 'cards'}
            </span>
            <span style="color: var(--text-dim)">·</span>
            <span class="trade-summary-price">{formatPrice(leftTotal(), props.currency)}</span>
          </span>
          <span class="primary-toolbar-arrow">→</span>
          <span class="trade-summary-side">
            <span class="trade-summary-price">{formatPrice(rightTotal(), props.currency)}</span>
            <span style="color: var(--text-dim)">·</span>
            <span class="trade-summary-count">
              {rightCount()} {rightCount() === 1 ? 'card' : 'cards'}
            </span>
          </span>
          <span class="primary-toolbar-sep" />
          <span class="primary-toolbar-balance">
            <span class="trade-summary-balance-label">Difference</span>
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
            <strong>Some cards from this saved trade could not be loaded.</strong>
            <button
              class="trade-decode-warnings-dismiss"
              onClick={() => setDecodeWarnings([])}
              aria-label="Dismiss warnings"
            >
              ×
            </button>
          </div>
          <ul class="trade-decode-warnings-list">
            <For each={decodeWarnings()}>{(w) => <li>{formatDecodeWarning(w)}</li>}</For>
          </ul>
        </div>
      </Show>

      <div class="col-toggle">
        <button
          classList={{ active: activePane() === 'left' }}
          onClick={() => setActivePane('left')}
        >
          Offering
          <span class="col-toggle-meta">
            {leftCount()} · {formatPrice(leftTotal(), props.currency)}
          </span>
        </button>
        <button
          classList={{ active: activePane() === 'right' }}
          onClick={() => setActivePane('right')}
        >
          Receiving
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
          altMode={includeDecks()}
          onAltModeChange={() => setIncludeDecks((prev) => !prev)}
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
          autocompleteLoading={
            scryfallMode() ? scryfallSearch.autocompleteLoading() : tradeData.loadingWanted()
          }
          onAutocompleteSelect={handleRightSelect}
          altMode={scryfallMode()}
          onAltModeChange={handleScryfallModeChange}
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
              Clear this trade?
            </h3>
            <p class="trade-confirm-message">
              This will remove every card from both sides. The link in your address bar will also be
              cleared.
            </p>
            <div class="trade-confirm-actions">
              <button class="btn btn-secondary" onClick={() => setResetConfirmOpen(false)}>
                Cancel
              </button>
              <button class="btn btn-danger" onClick={handleResetConfirm}>
                Clear trade
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={picker()}>
        {(p) => (
          <TradePrintingPicker
            cardName={p().cardName}
            printings={scryfallSearch.printings()}
            loading={scryfallSearch.printingsLoading()}
            useScryfallImgUrls={props.useScryfallImgUrls}
            currency={props.currency}
            onSelect={handlePickerSelect}
            onClose={() => {
              setPicker(null)
              scryfallSearch.clearPrintings()
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
