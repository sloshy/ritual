import type { SearchProvider, SearchSourceNote } from '../../editor/search-provider'
import { autocompleteCardNames, fetchCardPrintings } from '../card-search'
import { apiActive } from '../api-base'

const SCRYFALL_NOTE: SearchSourceNote = {
  prefix: 'Search uses the ',
  linkText: 'Scryfall API',
  linkUrl: 'https://scryfall.com/docs/api/cards/autocomplete',
  suffix: ' — results may differ from the admin editor.',
}

/**
 * The public site's shared {@link SearchProvider}, used by every list editor's
 * search modal. The underlying card-search module dispatches per call — a live
 * backend answers with the admin editor's term matching over the server's card
 * cache; the static site asks Scryfall directly.
 *
 * `sourceNote` is a getter so the search UI tracks it reactively: the Scryfall
 * disclosure (whose whole premise is Scryfall's contiguous matching differing
 * from the admin's term matching) applies only while there is no live backend,
 * and reappears if a remote backend degrades mid-session.
 */
export const siteSearch: SearchProvider = {
  autocomplete: (query) => autocompleteCardNames(query),
  printings: (cardName) => fetchCardPrintings(cardName),
  get sourceNote(): SearchSourceNote | undefined {
    return apiActive() ? undefined : SCRYFALL_NOTE
  },
}
