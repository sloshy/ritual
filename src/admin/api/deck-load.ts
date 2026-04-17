import path from 'node:path'
import { getContentHash } from '../../content-hash'
import { importFromTextFile } from '../../importers/text-file'
import { resolveDeckFilePath, parseDeckFrontMatter } from '../../deck-file'
import { getErrorMessage } from '../../errors'
import { getBaseDir } from '../../base-dir'
import { addChangelogCardNames, fetchSymbolMap, loadDeckCardData } from './card-data-loader'

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

    await addChangelogCardNames(filePath, cardNames)

    const { cards, printings, lowestPriceCards, lowestPriceCardsEur, lowestPriceCardsTix } =
      await loadDeckCardData(cardNames)
    const symbolMap = await fetchSymbolMap()

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
