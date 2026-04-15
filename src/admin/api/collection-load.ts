import path from 'node:path'
import { parseCollectionFile } from '../../commands/price-collection'
import { cardCache } from '../../cache'
import { fetchCardData, fetchSymbology, getCardPrintings } from '../../scryfall'
import { computeRepresentativePrints } from '../../scryfall/client'
import { getErrorMessage } from '../../errors'
import { extractChangelogCardNames, parseChangelog } from '../../changelog-parser'
import { isPathWithinDir } from '../../path-validation'
import type { ScryfallCard } from '../../types'
import type { PriceCurrency } from '../../price-currency'
import { getBaseDir } from '../../base-dir'
import { ensureCacheForCards } from '../../cache'

const ALL_CURRENCIES: PriceCurrency[] = ['usd', 'eur', 'tix']

export async function handleCollectionLoad(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const rawSlug = pathParts[3]

    if (!rawSlug) {
      return Response.json(
        { success: false, message: 'Collection slug is required' },
        { status: 400 },
      )
    }

    const slug = decodeURIComponent(rawSlug)
    const collectionsDir = path.join(getBaseDir(), 'collections')
    const filePath = path.join(collectionsDir, slug + '.md')
    if (!isPathWithinDir(filePath, collectionsDir)) {
      return Response.json({ success: false, message: 'Invalid collection slug' }, { status: 400 })
    }
    const file = Bun.file(filePath)

    if (!(await file.exists())) {
      return Response.json(
        { success: false, message: `Collection '${slug}' not found` },
        { status: 404 },
      )
    }

    const content = await file.text()
    const { entries: rawEntries } = parseCollectionFile(content)

    // Normalize set codes to lowercase so they match Scryfall card keys
    const entries = rawEntries.map((e) => ({ ...e, set: e.set.toLowerCase() }))

    // Collect unique card names
    const cardNames = new Set<string>()
    for (const entry of entries) {
      cardNames.add(entry.name)
    }

    // Also include card names from the changelog so card links work
    const changelogPath = filePath.replace(/\.md$/, '.changes.md')
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

    // Cards keyed by "set:collectorNumber" for exact printing lookup
    const cards: Record<string, ScryfallCard | null> = {}
    const printings: Record<string, ScryfallCard[]> = {}

    for (const name of cardNames) {
      const cached = await cardCache.get(name)
      if (cached && cached.length > 0) {
        printings[name] = cached

        // Key each printing by set:collectorNumber
        for (const card of cached) {
          const key = `${card.set}:${card.collector_number}`
          cards[key] = card
        }

        // Also key by name for the search modal
        const sorted = [...cached].sort((a, b) =>
          (b.released_at ?? '').localeCompare(a.released_at ?? ''),
        )
        const repPrints = computeRepresentativePrints(sorted, sorted, ALL_CURRENCIES)
        cards[name] = repPrints.usd?.representative ?? cached[0]!
      } else {
        // Fallback to API
        const card = await fetchCardData(name, { silent: true })
        cards[name] = card
        if (card) {
          const key = `${card.set}:${card.collector_number}`
          cards[key] = card
          try {
            printings[name] = await getCardPrintings(name)
            for (const p of printings[name]!) {
              cards[`${p.set}:${p.collector_number}`] = p
            }
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

    return Response.json({
      success: true,
      entries,
      cards,
      printings,
      symbolMap,
      slug,
    })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
