import type { ScryfallCard } from '../../types'
import type { AddCardToStore } from '../../editor/card-data-utils'
import type { SearchProvider } from '../../editor/search-provider'

/**
 * Backfill image + printings for a card added by import/restore on the public
 * site. Adding a card from search already supplies the chosen printing (so
 * `scryfallCard` is present and nothing is fetched); this only runs for an
 * imported `add` of a card the list did not already contain, where the editor
 * calls back with no card data. Resolves a representative printing from Scryfall
 * (via the session cache) and hands it to the list's `addCard`. Fire-and-forget
 * — the card tile fills in reactively once the fetch resolves.
 */
export async function backfillImportedCard(
  search: SearchProvider,
  cardName: string,
  scryfallCard: ScryfallCard | undefined,
  addCard: AddCardToStore,
): Promise<void> {
  if (scryfallCard) return
  try {
    const printings = await search.printings(cardName)
    if (printings.length > 0) addCard(cardName, printings[0], printings)
  } catch {
    // The import path invokes this fire-and-forget; a Scryfall network failure
    // just leaves the card tile empty rather than surfacing an unhandled rejection.
  }
}
