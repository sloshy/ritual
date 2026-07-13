import type { SearchProvider } from '../../editor/search-provider'
import { autocompleteCardNames, fetchCardPrintings } from '../scryfall-search'

/**
 * Public-site {@link SearchProvider}: resolves card search directly against
 * Scryfall (the serverless site has no admin API), through the same browser
 * client the trade page's search box uses.
 */
export function createScryfallSearchProvider(): SearchProvider {
  return {
    autocomplete: (query) => autocompleteCardNames(query),
    printings: (cardName) => fetchCardPrintings(cardName),
  }
}
