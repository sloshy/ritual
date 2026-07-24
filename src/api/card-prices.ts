import { cardCache } from '../cache'
import { fetchRepresentativePrints } from '../scryfall'
import { getErrorMessage } from '../errors'
import type { ScryfallCard } from '../types'
import { VALID_CURRENCIES } from '../price-currency'
import type { PriceCurrency } from '../price-currency'
import { isPriceStale } from './card-price'

const ALL_CURRENCIES: PriceCurrency[] = [...VALID_CURRENCIES]

/** Upper bound on names per request, so one call can't queue hours of Scryfall refreshes. */
export const MAX_PRICE_NAMES = 500

export type CardPricesResponse = {
  success: boolean
  /** Union of every requested name's cached printings after the staleness-gated refresh. */
  cards: ScryfallCard[]
  message?: string
}

function parseNamesBody(body: unknown): string[] | string {
  if (typeof body !== 'object' || body === null) {
    return 'body must be a JSON object'
  }
  const names = (body as Record<string, unknown>).names
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
    return '"names" must be an array of strings'
  }
  if (names.length > MAX_PRICE_NAMES) {
    return `"names" must contain at most ${MAX_PRICE_NAMES} entries`
  }
  return names
}

/**
 * Batch price lookup: for each name, refresh from Scryfall when the cached
 * prices are stale (same 24h gate as `/api/card-price`), then return the union
 * of cached printings. A name that can't be resolved contributes nothing.
 */
export async function handleCardPrices(req: Request): Promise<Response> {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      body = null
    }
    const names = parseNamesBody(body)
    if (typeof names === 'string') {
      const resp: CardPricesResponse = { success: false, cards: [], message: names }
      return Response.json(resp, { status: 400 })
    }

    const cards: ScryfallCard[] = []
    for (const name of [...new Set(names)]) {
      try {
        const timestamp = await cardCache.getTimestamp(name)
        if (isPriceStale(timestamp)) {
          // Updates the cache as a side effect.
          await fetchRepresentativePrints(name, ALL_CURRENCIES)
        }
        const printings = await cardCache.get(name)
        if (printings) {
          cards.push(...printings)
        }
      } catch {
        // A failed name contributes nothing; the client keeps its current data.
      }
    }

    const resp: CardPricesResponse = { success: true, cards }
    return Response.json(resp)
  } catch (error) {
    const resp: CardPricesResponse = { success: false, cards: [], message: getErrorMessage(error) }
    return Response.json(resp, { status: 500 })
  }
}
