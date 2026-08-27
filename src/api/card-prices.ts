import { cardCache } from '../cache'
import { apiError, readJsonObjectBody } from './http'
import { fetchRepresentativePrints } from '../scryfall'
import { getErrorMessage } from '../util/errors'
import type { ScryfallCard } from '../scryfall/types'
import { VALID_CURRENCIES } from '../pricing/price-currency'
import type { PriceCurrency } from '../pricing/price-currency'
import { isPriceStale } from './card-price'

const ALL_CURRENCIES: PriceCurrency[] = [...VALID_CURRENCIES]

/** Upper bound on names per request, so one call can't queue hours of Scryfall refreshes. */
export const MAX_PRICE_NAMES = 500

/**
 * Body cap for a name batch. Sized from this route's own item limit rather than
 * the admin mutation budget: this is a bulk *query* that writes nothing, and a
 * full batch of card names runs well past 10 KiB — so borrowing that budget made
 * {@link MAX_PRICE_NAMES} unreachable, and the site's own 400-name batches
 * (`PRICES_BATCH_SIZE`) 413'd on a large price refresh. ~80 bytes per name is
 * roughly double the longest real card name plus its JSON quoting and comma.
 */
const MAX_PRICE_BODY_BYTES = MAX_PRICE_NAMES * 80

export type CardPricesResponse = {
  success: true
  /** Union of every requested name's cached printings after the staleness-gated refresh. */
  cards: ScryfallCard[]
}

function parseNamesBody(body: Record<string, unknown>): string[] | string {
  const { names } = body
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
    const parsed = await readJsonObjectBody(req, MAX_PRICE_BODY_BYTES)
    if (!parsed.ok) return parsed.response
    const names = parseNamesBody(parsed.body)
    if (typeof names === 'string') return apiError(names, 400)

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
    return apiError(getErrorMessage(error), 500)
  }
}
