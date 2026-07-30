import { computeHash } from '../../content-hash'
import { loadDeckFile } from '../../importers/text-file'
import { parseDeckFrontMatter } from '../../deck-file'
import { apiHandler } from '../utils'
import { getDecksDir } from '../../ritual-config'
import { addChangelogCardNames, fetchSymbolMap, loadDeckCardData } from './card-data-loader'
import { resolveDeckFile } from './list-file'
import { readListLoadRequest, stampLoadBody } from './list-load'
import { countDeck, filterDeck, isNarrowedLoad, toCountParams } from './list-load-params'
import type { DeckCardsLoadResult, DeckFullLoadResult, ListSummaryLoadResult } from './load-results'

/**
 * `GET /api/deck/:slug` — a deck, at the depth `?view=` asks for.
 *
 * - `full` (default) is the editor's payload: the deck plus every card, printing,
 *   price map, and the mana-symbol map.
 * - `cards` returns the deck lines and front matter only, skipping all of that.
 * - `summary` returns counts only.
 *
 * `section`, `nameContains`, `limit`, and `offset` filter the lines in every
 * view; `totalCount` reports how many matched before paging. In `full` the card
 * data is loaded for the filtered names only, so a narrow filter is cheap there
 * too. A summary's counts describe the whole filtered set — paging is ignored
 * there, so `?view=summary&limit=5` still reports the real totals.
 *
 * A narrowed body — in any view, summary included — is marked `partial` and
 * carries **no** `contentHash`, so it cannot be handed back to the save route as
 * if it were the whole list.
 */
export function handleDeckLoad(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const prologue = await readListLoadRequest(req, getDecksDir(), 'deck', resolveDeckFile)
    if (!prologue.ok) return prologue.response
    const { slug, filePath, params } = prologue.value

    const rawContent = await Bun.file(filePath).text()
    const { deck: loaded, warnings } = await loadDeckFile(filePath)
    const frontMatter = await parseDeckFrontMatter(filePath)
    // Hashed from the content itself, never read from (or persisted to) the
    // .sha256 sidecar: a load must not stamp a hand-edited file Ritual-clean,
    // and a stale sidecar must not hand the client a hash the save-side
    // validation would reject.
    const contentHash = computeHash(rawContent)

    if (params.view === 'summary') {
      // Counted over the filtered-but-unpaged deck: a count that shrank with the
      // page size would tell a paging client nothing it could page against.
      const { deck: counted } = filterDeck(loaded, toCountParams(params))
      const summary: ListSummaryLoadResult = {
        success: true,
        slug,
        view: 'summary',
        counts: countDeck(counted),
        warnings,
      }
      return Response.json(stampLoadBody(summary, isNarrowedLoad(params), contentHash))
    }

    const { deck, totalCount } = filterDeck(loaded, params)
    const partial = isNarrowedLoad(params)

    if (params.view === 'cards') {
      // Front matter travels with the cards view because the deck save flow
      // re-sends it; dropping it here would silently blank a deck's YAML.
      const body: DeckCardsLoadResult = {
        success: true,
        slug,
        view: 'cards',
        deck,
        frontMatter,
        totalCount,
        warnings,
      }
      return Response.json(stampLoadBody(body, partial, contentHash))
    }

    // Collect unique card names
    const cardNames = new Set<string>()
    for (const section of deck.sections) {
      for (const card of section.cards) {
        cardNames.add(card.name)
      }
    }

    await addChangelogCardNames(filePath, cardNames)

    const { cards, printings, lowestPriceCards, lowestPriceCardsEur, lowestPriceCardsTix } =
      await loadDeckCardData(cardNames)
    const symbolMap = await fetchSymbolMap()

    const body: DeckFullLoadResult = {
      success: true,
      view: 'full',
      deck,
      totalCount,
      cards,
      printings,
      lowestPriceCards,
      lowestPriceCardsEur,
      lowestPriceCardsTix,
      symbolMap,
      frontMatter,
      slug,
      warnings,
    }
    return Response.json(stampLoadBody(body, partial, contentHash))
  })
}
