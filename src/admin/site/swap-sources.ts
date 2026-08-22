/**
 * The admin site's {@link SwapSourceProvider}: each source list's full load
 * body (`GET /api/{type}/{slug}`), mapped to the planner's shape.
 */

import type { ListInfo } from '../../list-info'
import type { NamedListRef } from '../../site/combined-list'
import { isAbortError } from '../../site/utils'
import type {
  SwapSourceList,
  SwapSourceLoad,
  SwapSourceProvider,
} from '../../editor/swap-printings'
import { deckSectionsToSwapEntries, flatEntriesToSwapEntries } from '../../editor/swap-sources'
import type {
  CollectionFullLoadResult,
  DeckFullLoadResult,
  WantedFullLoadResult,
} from '../api/load-results'
import type { ApiErrorResponse } from '../api/save-helpers'
import { adminSearch, fetchAdminJson } from './editor-backend'
import { listInfosToNamedRefs } from './move-targets'

/** The three full load bodies, as the one parsed payload may be any of them. */
type FullLoadResult = DeckFullLoadResult | CollectionFullLoadResult | WantedFullLoadResult

/**
 * One list's full load body as the planner reads it; null when the route
 * refused. The body says what it is — a deck body carries `deck`, a flat one
 * `entries` — so the shape is narrowed from the payload, not trusted from the ref.
 */
function toSwapSourceList(
  ref: NamedListRef,
  body: FullLoadResult | ApiErrorResponse,
): SwapSourceList | null {
  if (body.success !== true) return null
  const entries =
    'deck' in body
      ? deckSectionsToSwapEntries(body.deck.sections)
      : flatEntriesToSwapEntries(body.entries)
  return { ref, entries, cards: body.cards, printings: body.printings }
}

/**
 * Build the provider over every admin list (`lists`, the `/api/lists`
 * resource). The edited list is not dropped here: the editor's swap controller
 * filters it out, since the admin editor switches lists without remounting. A
 * list whose load fails (a refused route or a network error) is reported in
 * `failed` rather than failing the whole load — or vanishing from it.
 */
export function createAdminSwapSourceProvider(
  lists: () => ListInfo[] | undefined,
): SwapSourceProvider {
  return {
    lists: () => listInfosToNamedRefs(lists()),
    load: async (refs, signal): Promise<SwapSourceLoad> => {
      const result: SwapSourceLoad = { lists: [], failed: [] }
      const loaded = await Promise.all(
        refs.map(async (ref): Promise<SwapSourceList | null> => {
          try {
            const body = (await fetchAdminJson(
              `/api/${ref.type}/${encodeURIComponent(ref.slug)}`,
              signal,
            )) as FullLoadResult | ApiErrorResponse
            return toSwapSourceList(ref, body)
          } catch (e) {
            if (isAbortError(e)) throw e
            console.error(`Swap printings: failed to load ${ref.type}/${ref.slug}:`, e)
            return null
          }
        }),
      )
      loaded.forEach((list, i) => {
        if (list === null) result.failed.push(refs[i]!)
        else result.lists.push(list)
      })
      return result
    },
    printings: adminSearch.printings,
  }
}
