import { cardCache } from '../../cache'
import {
  fetchRepresentativePrints,
  computeRepresentativePrints,
  getCardPrintings,
} from '../../scryfall'
import { getErrorMessage } from '../../errors'
import { getBannedPrintings } from '../../ritual-config'
import type { ScryfallCard } from '../../types'
import type { PriceCurrency } from '../../price-currency'

const ALL_CURRENCIES: PriceCurrency[] = ['usd', 'eur', 'tix']

export const PRICE_STALENESS_THRESHOLD_MS = 86_400_000 // 24 hours

export function isPriceStale(timestamp: number | null, now: number = Date.now()): boolean {
  return timestamp === null || now - timestamp > PRICE_STALENESS_THRESHOLD_MS
}

export type CardPriceResponse = {
  success: boolean
  printings: ScryfallCard[]
  representative: ScryfallCard | null
  lowestPriceCard: ScryfallCard | null
  lowestPriceCardEur: ScryfallCard | null
  lowestPriceCardTix: ScryfallCard | null
  message?: string
}

export async function handleCardPrice(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const name = url.searchParams.get('name')

    if (!name) {
      const resp: CardPriceResponse = {
        success: false,
        printings: [],
        representative: null,
        lowestPriceCard: null,
        lowestPriceCardEur: null,
        lowestPriceCardTix: null,
        message: 'name is required',
      }
      return Response.json(resp, { status: 400 })
    }

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
      const resp: CardPriceResponse = {
        success: false,
        printings: [],
        representative: null,
        lowestPriceCard: null,
        lowestPriceCardEur: null,
        lowestPriceCardTix: null,
        message: `No printings found for '${name}'`,
      }
      return Response.json(resp)
    }

    const sorted = [...printings].sort((a, b) =>
      (b.released_at ?? '').localeCompare(a.released_at ?? ''),
    )
    const repPrints = computeRepresentativePrints(
      sorted,
      sorted,
      ALL_CURRENCIES,
      getBannedPrintings(),
    )

    const fallback = printings[0]!
    const usdRep = repPrints.usd?.representative ?? fallback

    const resp: CardPriceResponse = {
      success: true,
      printings,
      representative: usdRep,
      lowestPriceCard: repPrints.usd?.cheapest ?? usdRep,
      lowestPriceCardEur: repPrints.eur?.cheapest ?? repPrints.eur?.representative ?? fallback,
      lowestPriceCardTix: repPrints.tix?.cheapest ?? repPrints.tix?.representative ?? fallback,
    }
    return Response.json(resp)
  } catch (error) {
    const resp: CardPriceResponse = {
      success: false,
      printings: [],
      representative: null,
      lowestPriceCard: null,
      lowestPriceCardEur: null,
      lowestPriceCardTix: null,
      message: getErrorMessage(error),
    }
    return Response.json(resp, { status: 500 })
  }
}
