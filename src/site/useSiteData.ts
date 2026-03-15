import { useState, useEffect } from 'preact/hooks'
import type { DeckSummary, CollectionSummary, SiteIndex } from './data-types'
import type { PriceCurrency } from '../price-currency'

export type UseSiteDataResult = {
  deckList: DeckSummary[] | null
  collectionList: CollectionSummary[] | null
  useScryfallImgUrls: boolean
  currency: PriceCurrency
  setCurrency: (c: PriceCurrency) => void
  availableCurrencies: PriceCurrency[]
  pricesDate: string | null
}

export function useSiteData(): UseSiteDataResult {
  const [deckList, setDeckList] = useState<DeckSummary[] | null>(null)
  const [collectionList, setCollectionList] = useState<CollectionSummary[] | null>(null)
  const [useScryfallImgUrls, setUseScryfallImgUrls] = useState(true)
  const [currency, setCurrency] = useState<PriceCurrency>('usd')
  const [availableCurrencies, setAvailableCurrencies] = useState<PriceCurrency[]>([
    'usd',
    'eur',
    'tix',
  ])
  const [pricesDate, setPricesDate] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch('index.json', { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to load site data: HTTP ${response.status}`)
        const data = (await response.json()) as SiteIndex
        setDeckList(data.decks)
        setCollectionList(data.collections ?? [])
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
    return () => controller.abort()
  }, [])

  return {
    deckList,
    collectionList,
    useScryfallImgUrls,
    currency,
    setCurrency,
    availableCurrencies,
    pricesDate,
  }
}
