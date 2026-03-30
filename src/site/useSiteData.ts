import { createSignal, onMount, onCleanup } from 'solid-js'
import type { Accessor, Setter } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary, SiteIndex } from './data-types'
import type { PriceCurrency } from '../price-currency'

export type UseSiteDataResult = {
  deckList: Accessor<DeckSummary[] | null>
  collectionList: Accessor<CollectionSummary[] | null>
  wantedListList: Accessor<WantedListSummary[] | null>
  useScryfallImgUrls: Accessor<boolean>
  currency: Accessor<PriceCurrency>
  setCurrency: Setter<PriceCurrency>
  availableCurrencies: Accessor<PriceCurrency[]>
  pricesDate: Accessor<string | null>
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

  onMount(() => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    void (async () => {
      try {
        const response = await fetch('index.json', { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to load site data: HTTP ${response.status}`)
        const data = (await response.json()) as SiteIndex
        setDeckList(data.decks)
        setCollectionList(data.collections ?? [])
        setWantedListList(data.wantedLists ?? [])
        setUseScryfallImgUrls(data.useScryfallImgUrls)
        if (data.defaultCurrency) setCurrency(data.defaultCurrency)
        if (data.availableCurrencies) setAvailableCurrencies(data.availableCurrencies)
        if (data.pricesDate) setPricesDate(data.pricesDate)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        console.error('Failed to load index:', e)
        setDeckList([])
        setCollectionList([])
      }
    })()
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
  }
}
