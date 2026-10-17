import type { ScryfallCard } from '../scryfall/types'
import type { ParameterlessKey } from '../i18n/t'
import type { CardsResponse } from '../api/cards'
import { apiActive, apiUrl, reportDataFetchError } from '../list-view/api-base'
import { HttpStatusError } from '../list-view/fetch-json'
import { batchFetchScryfall } from './scryfall-collection'

/**
 * Looking up cards that belong to none of your lists — the trade rows a shared
 * link encodes by Scryfall ID. Which backend answers depends on how the site is
 * deployed: a live API serves them from its own card cache, and the static site
 * has only Scryfall to ask. {@link cardLookupSource} is the code those rows carry
 * as their `sourceName`, so a row says where its data actually came from; the row
 * words it at render time through {@link CARD_LOOKUP_SOURCE_LABEL_KEYS}.
 */

/** IDs per request; the server caps a batch at `MAX_CARD_IDS`. */
const API_BATCH_SIZE = 100

/**
 * The backend that answered a lookup: the `sourceName` a card no list of yours
 * holds carries into its trade row. A code, never shown as is — and never on the
 * wire either: a trade URL encodes such a row by Scryfall ID alone.
 */
export type CardLookupSource = 'cache' | 'scryfall'

export function cardLookupSource(): CardLookupSource {
  return apiActive() ? 'cache' : 'scryfall'
}

/** The trade row's source tag for each lookup backend. */
export const CARD_LOOKUP_SOURCE_LABEL_KEYS = {
  cache: 'site.tradeRow.sourceCache',
  scryfall: 'site.tradeRow.sourceScryfall',
} as const satisfies Record<CardLookupSource, ParameterlessKey>

/**
 * The label key for a Scryfall-sourced row's `sourceName`, or `undefined` when it
 * is not a {@link CardLookupSource} code. Own keys only, so `constructor` and
 * friends never resolve.
 */
export function cardLookupSourceLabelKey(sourceName: string): ParameterlessKey | undefined {
  return isCardLookupSource(sourceName) ? CARD_LOOKUP_SOURCE_LABEL_KEYS[sourceName] : undefined
}

function isCardLookupSource(name: string): name is CardLookupSource {
  return Object.hasOwn(CARD_LOOKUP_SOURCE_LABEL_KEYS, name)
}

/**
 * Resolve Scryfall IDs to cards, through the live API's cache when there is one
 * and Scryfall's batch endpoint otherwise. IDs that can't be resolved are absent
 * from the result; a failed batch contributes nothing rather than throwing, so a
 * partial restore still beats losing every row. A batch that fails because the
 * backend is unreachable is reported, which drops a remote deployment back to
 * static mode — so the next lookup asks Scryfall rather than a dead API.
 */
export async function fetchCardsByIds(ids: readonly string[]): Promise<Map<string, ScryfallCard>> {
  if (!apiActive()) return batchFetchScryfall([...ids])

  const cards = new Map<string, ScryfallCard>()
  for (let i = 0; i < ids.length; i += API_BATCH_SIZE) {
    const slice = ids.slice(i, i + API_BATCH_SIZE)
    try {
      const query = slice.map((id) => encodeURIComponent(id)).join(',')
      const resp = await fetch(apiUrl(`api/cards?ids=${query}`))
      if (!resp.ok) {
        reportDataFetchError(new HttpStatusError(resp.status))
        continue
      }
      const data = (await resp.json()) as CardsResponse
      if (data.success) for (const card of data.cards) cards.set(card.id, card)
    } catch (error) {
      reportDataFetchError(error)
      continue
    }
  }
  return cards
}
