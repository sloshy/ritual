import { createApiSearchProvider } from '../../editor/search-provider'
import type { CardPriceResponse } from '../api/card-price'

/**
 * Admin-side wiring for the shared editor: the strategies that talk to the admin
 * server's API (search, list/data loads, prices). The public site provides its
 * own Scryfall/preloaded equivalents instead.
 */

/** Shared admin card-search backend (hits `/api/autocomplete` + `/api/card-printings`). */
export const adminSearch = createApiSearchProvider()

/** Fetch and parse a JSON payload from an admin API endpoint (same-origin credentials). */
export function fetchAdminJson(url: string, signal?: AbortSignal): Promise<unknown> {
  return fetch(url, { credentials: 'same-origin', signal }).then((r) => r.json())
}

/** Fetch a card's prices from the admin price API; null on failure or an unsuccessful response. */
export async function fetchCardPrice(cardName: string): Promise<CardPriceResponse | null> {
  try {
    const resp = await fetch(`/api/card-price?name=${encodeURIComponent(cardName)}`, {
      credentials: 'same-origin',
    })
    const data = (await resp.json()) as CardPriceResponse
    return data.success ? data : null
  } catch {
    return null
  }
}
