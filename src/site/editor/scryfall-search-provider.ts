import type { SearchProvider } from '../../editor/search-provider'
import { autocompleteCardNames, fetchCardPrintings } from '../scryfall-search'

/**
 * Public-site {@link SearchProvider}: resolves card search directly against
 * Scryfall (the serverless site has no admin API), through the same browser
 * client the trade page's search box uses.
 *
 * The `sourceNote` surfaces that difference in the dialog: Scryfall's
 * autocomplete matches the query as one contiguous string, so results differ
 * from the admin editor's term matching over the local card cache.
 */
export function createScryfallSearchProvider(): SearchProvider {
  return {
    autocomplete: (query) => autocompleteCardNames(query),
    printings: (cardName) => fetchCardPrintings(cardName),
    sourceNote: {
      prefix: 'Search uses the ',
      linkText: 'Scryfall API',
      linkUrl: 'https://scryfall.com/docs/api/cards/autocomplete',
      suffix: ' — results may differ from the admin editor.',
    },
  }
}
