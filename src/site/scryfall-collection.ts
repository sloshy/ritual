import type { ScryfallCard } from '../scryfall/types'

const SCRYFALL_API = 'https://api.scryfall.com'
const COLLECTION_BATCH_SIZE = 75

type ScryfallCollectionResponse = { data: ScryfallCard[]; not_found?: unknown[] }

/**
 * Fetch full ScryfallCard objects for the given IDs via the `/cards/collection` endpoint.
 * The endpoint accepts at most 75 identifiers per request, so larger inputs are split into
 * batches and merged. A failed batch contributes nothing to the result rather than throwing —
 * partial updates are preferable to losing all fetched cards on a single network error.
 */
export async function batchFetchScryfall(ids: string[]): Promise<Map<string, ScryfallCard>> {
  const map = new Map<string, ScryfallCard>()
  if (ids.length === 0) return map
  for (let i = 0; i < ids.length; i += COLLECTION_BATCH_SIZE) {
    const slice = ids.slice(i, i + COLLECTION_BATCH_SIZE)
    try {
      const resp = await fetch(`${SCRYFALL_API}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: slice.map((id) => ({ id })) }),
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as ScryfallCollectionResponse
      for (const card of data.data ?? []) map.set(card.id, card)
    } catch {
      continue
    }
  }
  return map
}
