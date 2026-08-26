import { createSignal, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { ScryfallCard } from '../scryfall/types'
import { autocompleteCardNames, fetchCardPrintings } from './card-search'
import { isAbortError } from '../util/errors'

const AUTOCOMPLETE_DEBOUNCE_MS = 300
const MIN_AUTOCOMPLETE_LENGTH = 2

export type UseCardSearchResult = {
  autocompleteResults: Accessor<string[]>
  autocompleteLoading: Accessor<boolean>
  printings: Accessor<ScryfallCard[]>
  printingsLoading: Accessor<boolean>
  fetchAutocomplete: (query: string) => void
  fetchPrintings: (cardName: string) => Promise<void>
  clearAutocomplete: () => void
  clearPrintings: () => void
}

/**
 * Trade-page card search: the browser card-search client (see `./card-search`,
 * which serves from the live API's cache when one is configured, else Scryfall)
 * wrapped in the reactive state the search box needs — debounced autocomplete,
 * loading flags, and an abort of the in-flight request whenever a newer one
 * starts or the page goes away.
 */
export function useCardSearch(): UseCardSearchResult {
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
    if (query.length < MIN_AUTOCOMPLETE_LENGTH) {
      autocompleteController?.abort()
      setAutocompleteResults([])
      return
    }

    debounceTimer = setTimeout(() => {
      void (async () => {
        autocompleteController?.abort()
        const controller = new AbortController()
        autocompleteController = controller
        setAutocompleteLoading(true)

        try {
          const names = await autocompleteCardNames(query, { signal: controller.signal })
          if (autocompleteController === controller) setAutocompleteResults(names)
        } catch (e) {
          if (isAbortError(e)) return
          console.warn('Card autocomplete failed:', e)
        } finally {
          // A superseded request must not clear the loading flag out from under
          // the newer one that replaced it.
          if (autocompleteController === controller) setAutocompleteLoading(false)
        }
      })()
    }, AUTOCOMPLETE_DEBOUNCE_MS)
  }

  const fetchPrintings = async (cardName: string): Promise<void> => {
    printingsController?.abort()
    const controller = new AbortController()
    printingsController = controller

    setPrintings([])
    setPrintingsLoading(true)
    try {
      const results = await fetchCardPrintings(cardName, { signal: controller.signal })
      if (printingsController === controller) setPrintings(results)
    } catch (e) {
      if (isAbortError(e)) return
      console.warn('Card printings fetch failed:', e)
    } finally {
      if (printingsController === controller) setPrintingsLoading(false)
    }
  }

  const clearAutocomplete = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    autocompleteController?.abort()
    setAutocompleteResults([])
    setAutocompleteLoading(false)
  }

  const clearPrintings = (): void => {
    printingsController?.abort()
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
