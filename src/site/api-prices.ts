import type { ScryfallCard } from '../types'
import type { CardPricesResponse } from '../api/card-prices'
import { apiUrl } from './api-base'

/** Names per request; the server caps a batch at 500. */
const PRICES_BATCH_SIZE = 400

/**
 * Batch price lookup against the live API's `POST /api/card-prices`: the server
 * refreshes stale prices from Scryfall into its cache and answers with the
 * union of each name's printings. Larger inputs are split into batches and
 * merged; a failed batch contributes nothing rather than throwing — partial
 * updates are preferable to losing everything on one network error. (Mirrors
 * `batchFetchScryfall`, the static site's id-based equivalent.)
 */
export async function batchFetchApiPrices(names: string[]): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = []
  if (names.length === 0) return cards
  for (let i = 0; i < names.length; i += PRICES_BATCH_SIZE) {
    const slice = names.slice(i, i + PRICES_BATCH_SIZE)
    try {
      const resp = await fetch(apiUrl('api/card-prices'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: slice }),
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as CardPricesResponse
      if (data.success) cards.push(...data.cards)
    } catch {
      continue
    }
  }
  return cards
}
