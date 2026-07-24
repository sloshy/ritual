import { batch, createSignal, onMount, onCleanup } from 'solid-js'
import type { Accessor, Setter } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary, SiteIndex } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { setSearchDebounceMs } from '../editor/search-debounce'
import { apiActive, apiBase, dataUrl, reportDataFetchError, setApiBase } from './api-base'
import { isAbortError } from './utils'

export type UseSiteDataResult = {
  deckList: Accessor<DeckSummary[] | null>
  collectionList: Accessor<CollectionSummary[] | null>
  wantedListList: Accessor<WantedListSummary[] | null>
  useScryfallImgUrls: Accessor<boolean>
  currency: Accessor<PriceCurrency>
  setCurrency: Setter<PriceCurrency>
  availableCurrencies: Accessor<PriceCurrency[]>
  pricesDate: Accessor<string | null>
  /** Refetch the index from the live backend. No-op in static mode. */
  refetch: () => void
}

export function useSiteData(): UseSiteDataResult {
  const [deckList, setDeckList] = createSignal<DeckSummary[] | null>(null)
  const [collectionList, setCollectionList] = createSignal<CollectionSummary[] | null>(null)
  const [wantedListList, setWantedListList] = createSignal<WantedListSummary[] | null>(null)
  const [useScryfallImgUrls, setUseScryfallImgUrls] = createSignal(true)
  const [currency, setCurrency] = createSignal<PriceCurrency>('usd')
  const [availableCurrencies, setAvailableCurrencies] = createSignal<PriceCurrency[]>([
    'usd',
    'eur',
    'tix',
  ])
  const [pricesDate, setPricesDate] = createSignal<string | null>(null)

  // The configured default currency is applied once; live refetches must not
  // clobber a currency the user has since picked.
  let currencyApplied = false

  const applyIndex = (data: SiteIndex): void => {
    // Batched: this runs from async contexts (no auto-batching), and consumers
    // deriving from several of these signals must never observe a half-applied
    // index between the individual writes.
    batch(() => {
      setDeckList(data.decks)
      setCollectionList(data.collections ?? [])
      setWantedListList(data.wantedLists ?? [])
      setUseScryfallImgUrls(data.useScryfallImgUrls)
      if (data.defaultCurrency && !currencyApplied) {
        setCurrency(data.defaultCurrency)
        currencyApplied = true
      }
      if (data.availableCurrencies) setAvailableCurrencies(data.availableCurrencies)
      if (data.pricesDate) setPricesDate(data.pricesDate)
      if (typeof data.searchDebounceMs === 'number') setSearchDebounceMs(data.searchDebounceMs)
    })
  }

  const fetchIndex = async (url: string, signal?: AbortSignal): Promise<SiteIndex> => {
    const response = await fetch(url, signal ? { signal } : undefined)
    if (!response.ok) throw new Error(`Failed to load site data: HTTP ${response.status}`)
    return (await response.json()) as SiteIndex
  }

  const loadInitial = async (signal: AbortSignal): Promise<void> => {
    try {
      // The origin's own index: live when served by `serve --api` (which emits
      // apiBaseUrl: ''), baked on a static host.
      const data = await fetchIndex('index.json', signal)
      setApiBase(data.apiBaseUrl ?? null)
      if (data.apiBaseUrl) {
        // Split deployment: prefer the remote live index, keeping the baked
        // copy (and degrading to static behavior) when it is unreachable.
        try {
          applyIndex(await fetchIndex(dataUrl('index.json'), signal))
          return
        } catch (e) {
          reportDataFetchError(e)
        }
      }
      applyIndex(data)
    } catch (e) {
      if (isAbortError(e)) return
      console.error('Failed to load index:', e)
      setDeckList([])
      setCollectionList([])
    }
  }

  // Monotonic token: overlapping refetches (route change + tab focus) must not
  // let a stale response overwrite a fresher one.
  let refetchToken = 0

  const refetch = (): void => {
    if (!apiActive()) return
    const token = ++refetchToken
    void fetchIndex(dataUrl('index.json'))
      .then((data) => {
        if (token === refetchToken) applyIndex(data)
      })
      .catch((e: unknown) => {
        if (token !== refetchToken) return
        // A dead remote backend degrades the whole app to the baked data; a
        // same-origin hiccup just keeps the data we already have.
        reportDataFetchError(e)
        if (apiBase() === '') console.error('Failed to refresh index:', e)
      })
  }

  onMount(() => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    void loadInitial(controller.signal)

    // Live mode: returning to a long-idle tab refreshes the summaries.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisibility)
    onCleanup(() => document.removeEventListener('visibilitychange', onVisibility))
  })

  return {
    deckList,
    collectionList,
    wantedListList,
    useScryfallImgUrls,
    currency,
    setCurrency,
    availableCurrencies,
    pricesDate,
    refetch,
  }
}
