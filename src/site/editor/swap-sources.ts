/**
 * The public site's {@link SwapSourceProvider}: the other lists' baked detail
 * JSON (the same loader the combined view and Find page use), seeding the
 * session cache so the wizard's printing lookups and prices resolve like
 * everywhere else on the site.
 */

import {
  type LoadedListDetail,
  type NamedListRef,
  listRefKey,
  loadCombinedDetails,
  mergeCardMaps,
  mergePrintingMaps,
} from '../../list-view/combined-list'
import { seedCards, seedPrintings } from '../../list-view/session-cache'
import type {
  SwapSourceList,
  SwapSourceLoad,
  SwapSourceProvider,
} from '../../editor/swap-printings'
import { deckSectionsToSwapEntries, flatEntriesToSwapEntries } from '../../editor/swap-sources'
import { siteSearch } from './site-search'

/**
 * One loaded list as the planner reads it. A baked collection entry's `finish`
 * is the *resolved* display finish (see `CollectionCardEntry.finish`), passed
 * through as-is: a move planned from it names that finish explicitly, which
 * is the same physical copy — a foil-only printing's bare line and its
 * `[foil]` spelling describe one card — so the accepted divergence from the
 * admin provider (which sees the line's own token) is a token, never a copy.
 */
function toSwapSourceList(loaded: LoadedListDetail): SwapSourceList {
  const ref: NamedListRef = { ...loaded.ref, name: loaded.name }
  const entries =
    loaded.kind === 'deck'
      ? deckSectionsToSwapEntries(loaded.detail.deck.sections)
      : flatEntriesToSwapEntries(loaded.detail.entries)
  return {
    ref,
    entries,
    cards: loaded.detail.cards,
    printings: loaded.detail.printings ?? {},
  }
}

/**
 * Build the provider over every list on the site (`lists`, normally the
 * site's `allNamedLists`). The edited list is not dropped here: the editor's
 * swap controller filters it out, since only it knows which list is open. A
 * list that fails to load (`loadCombinedDetails` skips it, as the combined
 * view does) is reported in `failed` — every requested ref that came back
 * without a detail.
 */
export function createPublicSwapSourceProvider(
  lists: () => readonly NamedListRef[],
): SwapSourceProvider {
  return {
    lists: () => [...lists()],
    load: async (refs, signal): Promise<SwapSourceLoad> => {
      const loaded = await loadCombinedDetails([...refs], signal)
      seedCards(mergeCardMaps(loaded))
      seedPrintings(mergePrintingMaps(loaded))
      const loadedKeys = new Set(loaded.map((detail) => listRefKey(detail.ref)))
      return {
        lists: loaded.map(toSwapSourceList),
        failed: refs.filter((ref) => !loadedKeys.has(listRefKey(ref))),
      }
    },
    printings: (name) => siteSearch.printings(name),
  }
}
