import { createSignal, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { ScryfallCard } from '../types'
import { getPrintingsByName, putFetchedPrintings } from './session-cache'

const SCRYFALL_API = 'https://api.scryfall.com'

export type ScryfallAutocompleteResponse = {
  object: string
  total_values: number
  data: string[]
}

export type ScryfallListResponse = {
  object: string
  total_cards: number
  has_more: boolean
  data: ScryfallCard[]
}

export type UseScryfallBrowserSearchResult = {
  autocompleteResults: Accessor<string[]>
  autocompleteLoading: Accessor<boolean>
  printings: Accessor<ScryfallCard[]>
  printingsLoading: Accessor<boolean>
  fetchAutocomplete: (query: string) => void
  fetchPrintings: (cardName: string) => Promise<void>
  clearAutocomplete: () => void
  clearPrintings: () => void
}

export function useScryfallBrowserSearch(): UseScryfallBrowserSearchResult {
  const [autocompleteResults, setAutocompleteResults] = createSignal<string[]>([])
  const [autocompleteLoading, setAutocompleteLoading] = createSignal(false)
  const [printings, setPrintings] = createSignal<ScryfallCard[]>([])
  const [printingsLoading, setPrintingsLoading] = createSignal(false)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let autocompleteController: AbortController | null = null
  let printingsController: AbortController | null = null

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    autocompleteController?.abort()
    printingsController?.abort()
  })

  const fetchAutocomplete = (query: string): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (query.length < 2) {
      if (autocompleteController) autocompleteController.abort()
      setAutocompleteResults([])
      return
    }

    debounceTimer = setTimeout(() => {
      void (async () => {
        if (autocompleteController) autocompleteController.abort()
        autocompleteController = new AbortController()
        setAutocompleteLoading(true)

        try {
          const url = `${SCRYFALL_API}/cards/autocomplete?q=${encodeURIComponent(query)}`
          const resp = await fetch(url, { signal: autocompleteController.signal })
          if (!resp.ok) return
          const data = (await resp.json()) as ScryfallAutocompleteResponse
          setAutocompleteResults(data.data ?? [])
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
          console.warn('Scryfall autocomplete failed:', e)
        } finally {
          setAutocompleteLoading(false)
        }
      })()
    }, 300)
  }

  const fetchPrintings = async (cardName: string): Promise<void> => {
    if (printingsController) printingsController.abort()
    printingsController = new AbortController()
    const { signal } = printingsController

    // Reuse printings already shipped with the site or fetched earlier this session.
    const cached = getPrintingsByName(cardName)
    if (cached) {
      setPrintings(cached)
      setPrintingsLoading(false)
      return
    }

    setPrintings([])
    setPrintingsLoading(true)
    try {
      const query = `!"${cardName}"`
      const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=desc`
      let searchFailed = false
      try {
        const resp = await fetch(url, { signal })
        if (!resp.ok) {
          searchFailed = true
        } else {
          const data = (await resp.json()) as ScryfallListResponse
          const results = data.data ?? []
          setPrintings(results)
          putFetchedPrintings(cardName, results, Date.now())
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        searchFailed = true
      }
      if (searchFailed) {
        const namedUrl = `${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(cardName)}`
        const namedResp = await fetch(namedUrl, { signal })
        if (namedResp.ok) {
          const card = (await namedResp.json()) as ScryfallCard
          setPrintings([card])
          putFetchedPrintings(cardName, [card], Date.now())
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      console.warn('Scryfall printings fetch failed:', e)
    } finally {
      setPrintingsLoading(false)
    }
  }

  const clearAutocomplete = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (autocompleteController) autocompleteController.abort()
    setAutocompleteResults([])
    setAutocompleteLoading(false)
  }

  const clearPrintings = (): void => {
    if (printingsController) printingsController.abort()
    setPrintings([])
    setPrintingsLoading(false)
  }

  return {
    autocompleteResults,
    autocompleteLoading,
    printings,
    printingsLoading,
    fetchAutocomplete,
    fetchPrintings,
    clearAutocomplete,
    clearPrintings,
  }
}
