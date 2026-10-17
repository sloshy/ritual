import { cardCache } from '../cache'
import { compareData } from '../i18n/collate'
import {
  fetchRepresentativePrints,
  computeRepresentativePrints,
  getCardPrintings,
} from '../scryfall'
import { caughtMessage, statusForError } from './http'
import { apiMessage, pickMessage } from './result'
import type { SyncMessage } from '../sync/message'
import { getBannedPrintings } from '../config/ritual-config'
import type { ScryfallCard } from '../scryfall/types'
import { VALID_CURRENCIES } from '../pricing/price-currency'
import type { PriceCurrency } from '../pricing/price-currency'

const ALL_CURRENCIES: PriceCurrency[] = [...VALID_CURRENCIES]

export const PRICE_STALENESS_THRESHOLD_MS = 86_400_000 // 24 hours

export function isPriceStale(timestamp: number | null, now: number = Date.now()): boolean {
  return timestamp === null || now - timestamp > PRICE_STALENESS_THRESHOLD_MS
}

/** The card resolved: its printings, and the representative and cheapest per store. */
export type CardPriceSuccess = {
  success: true
  printings: ScryfallCard[]
  /** The USD representative printing (recent, mid-priced). */
  representative: ScryfallCard
  lowestPriceCard: ScryfallCard
  lowestPriceCardEur: ScryfallCard
  lowestPriceCardTix: ScryfallCard
}

/**
 * The request was refused or the lookup failed. The printing fields stay, empty
 * and null, so the wire shape is the same either way. A failure carries the
 * message triple; one raised with a catalog key (a cache error) carries its key
 * and possibly nested params.
 */
export type CardPriceFailure = SyncMessage & {
  success: false
  printings: []
  representative: null
  lowestPriceCard: null
  lowestPriceCardEur: null
  lowestPriceCardTix: null
}

/** `GET /api/card-price` body. */
export type CardPriceResponse = CardPriceSuccess | CardPriceFailure

/** The one refusal body for this route, at `status`. */
function priceRefusal(message: SyncMessage, status: number): Response {
  const body: CardPriceFailure = {
    success: false,
    printings: [],
    representative: null,
    lowestPriceCard: null,
    lowestPriceCardEur: null,
    lowestPriceCardTix: null,
    ...pickMessage(message),
  }
  return Response.json(body, { status })
}

export async function handleCardPrice(req: Request): Promise<Response> {
  try {
    // Trimmed at the parse boundary: the name is a cache key, and
    // `?name=%20Sol+Ring` must resolve like `Sol Ring`.
    const name = new URL(req.url).searchParams.get('name')?.trim()
    if (!name) return priceRefusal(apiMessage('admin.api.field.required', { field: 'name' }), 400)

    const timestamp = await cardCache.getTimestamp(name)
    const stale = isPriceStale(timestamp)

    let printings: ScryfallCard[]

    if (stale) {
      // Fetch fresh data from Scryfall; fetchRepresentativePrints updates the cache as a side effect
      await fetchRepresentativePrints(name, ALL_CURRENCIES)
      printings = (await cardCache.get(name)) ?? []

      // If the cache-backed fetch returned nothing, fall back to a direct printings lookup
      if (printings.length === 0) {
        printings = await getCardPrintings(name)
        if (printings.length > 0) {
          await cardCache.set(name, printings)
        }
      }
    } else {
      printings = (await cardCache.get(name)) ?? []
    }

    if (printings.length === 0) {
      return priceRefusal(apiMessage('admin.api.card.noPrintings', { name }), 404)
    }

    const sorted = [...printings].sort((a, b) =>
      compareData(b.released_at ?? '', a.released_at ?? ''),
    )
    const repPrints = computeRepresentativePrints(
      sorted,
      sorted,
      ALL_CURRENCIES,
      getBannedPrintings(),
    )

    const fallback = printings[0]!
    const usdRep = repPrints.usd?.representative ?? fallback

    const resp: CardPriceSuccess = {
      success: true,
      printings,
      representative: usdRep,
      lowestPriceCard: repPrints.usd?.cheapest ?? usdRep,
      lowestPriceCardEur: repPrints.eur?.cheapest ?? repPrints.eur?.representative ?? fallback,
      lowestPriceCardTix: repPrints.tix?.cheapest ?? repPrints.tix?.representative ?? fallback,
    }
    return Response.json(resp)
  } catch (error) {
    return priceRefusal(caughtMessage(error), statusForError(error))
  }
}
