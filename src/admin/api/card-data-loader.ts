import { cardCache, ensureCacheForCards } from '../../cache'
import { compareData } from '../../i18n/collate'
import { fetchCardData, fetchSymbology, getCardPrintings } from '../../scryfall'
import { computeRepresentativePrints } from '../../scryfall/client'
import { getBannedPrintings } from '../../ritual-config'
import { extractChangelogCardNames, parseChangelog } from '../../changelog-parser'
import type { ScryfallCard } from '../../types'
import type { PriceCurrency } from '../../price-currency'
import { indexPrintingCard } from '../../editor/card-data-utils'

const ALL_CURRENCIES: PriceCurrency[] = ['usd', 'eur', 'tix']

export type DeckCardLoadResult = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  lowestPriceCards: Record<string, ScryfallCard | null>
  lowestPriceCardsEur: Record<string, ScryfallCard | null>
  lowestPriceCardsTix: Record<string, ScryfallCard | null>
}

export type EntryCardLoadResult = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
}

/** Add card names referenced in a file's changelog to the given set. */
export async function addChangelogCardNames(
  filePath: string,
  cardNames: Set<string>,
): Promise<void> {
  const changelogPath = filePath.replace(/\.(txt|md)$/, '.changes.md')
  const changelogFile = Bun.file(changelogPath)
  if (await changelogFile.exists()) {
    const changelogContent = await changelogFile.text()
    const pages = parseChangelog(changelogContent)
    for (const name of extractChangelogCardNames(pages)) {
      cardNames.add(name)
    }
  }
}

/** Fetch Scryfall symbology and return a symbol → SVG URI map. */
export async function fetchSymbolMap(): Promise<Record<string, string>> {
  const symbols = await fetchSymbology()
  const symbolMap: Record<string, string> = {}
  for (const sym of symbols) {
    if (sym.symbol && sym.svg_uri) {
      symbolMap[sym.symbol] = sym.svg_uri
    }
  }
  return symbolMap
}

/** Load card data keyed by name, with per-currency lowest-price tracking (for decks). */
export async function loadDeckCardData(cardNames: Set<string>): Promise<DeckCardLoadResult> {
  await ensureCacheForCards(cardNames)

  const bannedPrintings = getBannedPrintings()
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
        compareData(b.released_at ?? '', a.released_at ?? ''),
      )
      const repPrints = computeRepresentativePrints(sorted, sorted, ALL_CURRENCIES, bannedPrintings)

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

  return { cards, printings, lowestPriceCards, lowestPriceCardsEur, lowestPriceCardsTix }
}

/** Load card data keyed by name and set:collectorNumber (for collections/wanted lists). */
export async function loadEntryCardData(cardNames: Set<string>): Promise<EntryCardLoadResult> {
  await ensureCacheForCards(cardNames)

  const bannedPrintings = getBannedPrintings()
  const cards: Record<string, ScryfallCard | null> = {}
  const printings: Record<string, ScryfallCard[]> = {}

  for (const name of cardNames) {
    const cached = await cardCache.get(name)
    if (cached && cached.length > 0) {
      printings[name] = cached

      // Foreign-language objects key under `set:cn@lang`; the plain `set:cn`
      // slot keeps the default-language (en) object so unpinned lines and
      // English entries resolve exactly as before an `all_cards` cache.
      for (const card of cached) {
        indexPrintingCard(cards, card)
      }

      const sorted = [...cached].sort((a, b) =>
        compareData(b.released_at ?? '', a.released_at ?? ''),
      )
      const repPrints = computeRepresentativePrints(sorted, sorted, ALL_CURRENCIES, bannedPrintings)
      cards[name] = repPrints.usd?.representative ?? cached[0]!
    } else {
      const card = await fetchCardData(name, { silent: true })
      cards[name] = card
      if (card) {
        indexPrintingCard(cards, card)
        try {
          printings[name] = await getCardPrintings(name)
          for (const p of printings[name]) {
            indexPrintingCard(cards, p)
          }
        } catch {
          printings[name] = [card]
        }
      } else {
        printings[name] = []
      }
    }
  }

  return { cards, printings }
}
