import path from 'node:path'
import { getContentHash } from '../../content-hash'
import { importFromTextFile } from '../../importers/text-file'
import { resolveDeckFilePath, parseDeckFrontMatter } from '../../deck-file'
import { cardCache } from '../../cache'
import { fetchCardData, fetchSymbology, getCardPrintings } from '../../scryfall'
import { computeRepresentativePrints } from '../../scryfall/client'
import { getErrorMessage } from '../../errors'
import { extractChangelogCardNames, parseChangelog } from '../../changelog-parser'
import type { ScryfallCard } from '../../types'
import type { PriceCurrency } from '../../price-currency'
import { getBaseDir } from '../../base-dir'
import { ensureCacheForCards } from '../../cache'

const ALL_CURRENCIES: PriceCurrency[] = ['usd', 'eur', 'tix']

export async function handleDeckLoad(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const slug = pathParts[3]

    if (!slug) {
      return Response.json({ success: false, message: 'Deck slug is required' }, { status: 400 })
    }

    const decksDir = path.join(getBaseDir(), 'decks')
    const filePath = await resolveDeckFilePath(decksDir, slug)

    if (!filePath) {
      return Response.json({ success: false, message: `Deck '${slug}' not found` }, { status: 404 })
    }

    const rawContent = await Bun.file(filePath).text()
    const deck = await importFromTextFile(filePath)
    const frontMatter = await parseDeckFrontMatter(filePath)

    // Collect unique card names
    const cardNames = new Set<string>()
    for (const section of deck.sections) {
      for (const card of section.cards) {
        cardNames.add(card.name)
      }
    }

    // Also include card names from the changelog so card links work
    const changelogPath = filePath.replace(/\.(txt|md)$/, '.changes.md')
    const changelogFile = Bun.file(changelogPath)
    if (await changelogFile.exists()) {
      const changelogContent = await changelogFile.text()
      const pages = parseChangelog(changelogContent)
      for (const name of extractChangelogCardNames(pages)) {
        cardNames.add(name)
      }
    }

    // If many cards are uncached, do a bulk cache refresh first
    await ensureCacheForCards(cardNames)

    // Fetch card data and compute representative printings
    const cards: Record<string, ScryfallCard | null> = {}
    const printings: Record<string, ScryfallCard[]> = {}
    const lowestPriceCards: Record<string, ScryfallCard | null> = {}
    const lowestPriceCardsEur: Record<string, ScryfallCard | null> = {}
    const lowestPriceCardsTix: Record<string, ScryfallCard | null> = {}

    for (const name of cardNames) {
      const cached = await cardCache.get(name)
      if (cached && cached.length > 0) {
        printings[name] = cached

        // Sort by release date descending (newest first) for representative selection
        const sorted = [...cached].sort((a, b) =>
          (b.released_at ?? '').localeCompare(a.released_at ?? ''),
        )
        const repPrints = computeRepresentativePrints(sorted, sorted, ALL_CURRENCIES)

        // Use USD representative as the display card (matching build-site behavior)
        const usdRep = repPrints.usd?.representative ?? null
        cards[name] = usdRep ?? cached[0]!

        const fallback = cached[0]!
        lowestPriceCards[name] = repPrints.usd?.cheapest ?? usdRep ?? fallback
        lowestPriceCardsEur[name] =
          repPrints.eur?.cheapest ?? repPrints.eur?.representative ?? fallback
        lowestPriceCardsTix[name] =
          repPrints.tix?.cheapest ?? repPrints.tix?.representative ?? fallback
      } else {
        // Fallback to API
        const card = await fetchCardData(name, { silent: true })
        cards[name] = card
        lowestPriceCards[name] = card
        lowestPriceCardsEur[name] = card
        lowestPriceCardsTix[name] = card
        if (card) {
          try {
            printings[name] = await getCardPrintings(name)
          } catch {
            printings[name] = [card]
          }
        } else {
          printings[name] = []
        }
      }
    }

    // Fetch symbol map
    const symbols = await fetchSymbology()
    const symbolMap: Record<string, string> = {}
    for (const sym of symbols) {
      if (sym.symbol && sym.svg_uri) {
        symbolMap[sym.symbol] = sym.svg_uri
      }
    }

    const contentHash = await getContentHash(filePath, rawContent)

    return Response.json({
      success: true,
      deck,
      cards,
      printings,
      lowestPriceCards,
      lowestPriceCardsEur,
      lowestPriceCardsTix,
      symbolMap,
      frontMatter,
      slug,
      contentHash,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
