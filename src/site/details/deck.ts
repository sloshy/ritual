import path from 'node:path'
import { loadDeckFile } from '../../importers/text-file'
import { parseDeckFrontMatter } from '../../deck-file'
import { extractChangelogCardNames } from '../../changelog-parser'
import type { ChangelogPage } from '../../changelog-parser'
import { effectiveLabels, isPriceless, type CardLabel } from '../../card-labels'
import type { CardArtMap } from '../../card-art'
import { extractPrimerCardNames } from '../../primer-parser'
import { resolveDeckFormat, getMainDeckSize } from '../../deck-format'
import { findPrinting, hasSpecificPrinting } from '../../card-printing'
import { resolveCardImageSources } from '../image-sources'
import { getCardPrice } from '../../price-currency'
import type { PriceCurrency } from '../../price-currency'
import { getErrorMessage } from '../../errors'
import type { Card, DeckData, ScryfallCard } from '../../types'
import type { BakedDeckData, DeckDetail, DeckSummary } from '../data-types'
import {
  bakeBuylistQuotes,
  cardIdsOf,
  customArtLookup,
  loadListSidecars,
  slugifyListName,
} from './shared'
import type { BuylistBakeSource, CustomArtLookup } from './shared'
import type { SiteDetailContext } from './types'

export type LoadedDeck = {
  data: DeckData
  changelog: ChangelogPage[]
  /** The deck's default card labels from its front matter, when declared. */
  labels?: CardLabel[]
  /** Custom art from the `.art.json` sidecar, keyed by card id. */
  art?: CardArtMap
  /** Lines the deck parser could not read — reported by callers, never fatal. */
  warnings: string[]
  /** ISO timestamp of the deck file's mtime, or undefined for non-file sources. */
  fileMtime?: string
}

/**
 * Load a deck markdown file plus its `.changes.md` sidecar. Returns an error
 * message string when the deck file can't be read or parsed.
 */
export async function loadDeckSource(
  decksDir: string,
  source: string,
): Promise<LoadedDeck | string> {
  const fileName = path.basename(source.endsWith('.md') ? source : `${source}.md`)
  const filePath = path.join(decksDir, fileName)
  let data: DeckData
  let warnings: string[]
  let labels: CardLabel[] | undefined
  try {
    const parsed = await loadDeckFile(filePath)
    data = parsed.deck
    warnings = parsed.warnings
    // The deck's label default lives in front matter, which the deck parser
    // does not project onto DeckData; the site resolves each line against it.
    labels = (await parseDeckFrontMatter(filePath)).labels
  } catch (e) {
    return getErrorMessage(e)
  }

  const baseName = source.endsWith('.md') ? source.slice(0, -3) : source
  const { changelog, fileMtime, art, artWarnings } = await loadListSidecars(
    decksDir,
    baseName,
    filePath,
    { knownCardIds: cardIdsOf(data.sections.flatMap((section) => section.cards)) },
  )

  return { data, changelog, labels, art, warnings: [...warnings, ...artWarnings], fileMtime }
}

/**
 * The deck's card lines with their custom art baked on: the display URL the
 * build could resolve, and — for every reference, deployed or not — the
 * pricelessness fact. Carrying both is why this is not the editors'
 * `withDeckArtUrls`, which knows only about display URLs: a card whose art file
 * never made it into `dist/` shows its real printing and must still read
 * `CUSTOM` where its price would be.
 */
function withDeckCustomArt(deck: DeckData, artFor: CustomArtLookup): BakedDeckData {
  return {
    ...deck,
    sections: deck.sections.map((section) => ({
      ...section,
      cards: section.cards.map((card) => {
        const art = artFor(card.cardId)
        return art.hasCustomArt === true ? { ...card, ...art } : card
      }),
    })),
  }
}

export type DeckArtifacts = { slug: string; detail: DeckDetail; summary: DeckSummary }

/** Build a deck's detail JSON payload and index summary from prefetched card data. */
export async function buildDeckArtifacts(
  loaded: LoadedDeck,
  ctx: SiteDetailContext,
): Promise<DeckArtifacts> {
  const { data: deckData, changelog, fileMtime } = loaded
  const { cardData, availableCurrencies, useScryfallImgUrls, defaultCurrency } = ctx
  // Resolved once and used twice: it decides what a card's art bakes to, and —
  // because a copy wearing custom art is no longer the printing a price would be
  // for — whether the card is priced at all. Those are deliberately two answers
  // from one lookup: a reference whose file the build could not deploy bakes no
  // display URL (the card shows its real printing) and still prices at nothing,
  // which is how the site stays in step with what `ritual price` reads.
  const customArtFor = customArtLookup(loaded.art, ctx)
  /**
   * A proxy is not a real card and a custom-art copy is not a printing: either
   * way it is priced at nothing, counts toward no shortfall, and is offered to
   * no buyer.
   */
  const pricesAtNothing = (card: Card): boolean =>
    isPriceless(
      effectiveLabels(card.labels, loaded.labels),
      customArtFor(card.cardId).hasCustomArt === true,
    )
  const hasUsd = availableCurrencies.includes('usd')
  const hasEur = availableCurrencies.includes('eur')
  const hasTix = availableCurrencies.includes('tix')
  const cheapestUsd = cardData.cheapest.usd ?? {}
  const cheapestEur = cardData.cheapest.eur ?? {}
  const cheapestTix = cardData.cheapest.tix ?? {}

  // Find Featured Card
  let featured: ScryfallCard | null = null
  const commanderSection = deckData.sections.find(
    (s) => s.name.toLowerCase() === 'commander' || s.name.toLowerCase() === 'commanders',
  )

  const deckCards: ScryfallCard[] = []
  deckData.sections.forEach((s) =>
    s.cards.forEach((c) => {
      const card = cardData.cards[c.name]
      if (card) deckCards.push(card)
    }),
  )

  if (commanderSection && commanderSection.cards[0]) {
    const cmdrName = commanderSection.cards[0].name
    featured = cardData.cards[cmdrName] || null
  }

  if (!featured && deckCards.length > 0) {
    let maxPrice = -1
    for (const card of deckCards) {
      const price = parseFloat(card.prices.usd || '0')
      if (price > maxPrice) {
        maxPrice = price
        featured = card
      }
    }
  }

  const slug = slugifyListName(deckData.name)

  // Build deck-specific card map and printings (only cards in this deck)
  const deckCardMap: Record<string, ScryfallCard | null> = {}
  const deckPrintingsMap: Record<string, ScryfallCard[]> = {}
  const deckLowestPriceCardMap: Record<string, ScryfallCard | null> = {}
  const deckLowestPriceCardMapEur: Record<string, ScryfallCard | null> = {}
  const deckLowestPriceCardMapTix: Record<string, ScryfallCard | null> = {}
  deckData.sections.forEach((s) =>
    s.cards.forEach((c) => {
      deckCardMap[c.name] = cardData.cards[c.name] ?? null
      if (cardData.printings[c.name]) {
        deckPrintingsMap[c.name] = cardData.printings[c.name]!
      }
      if (hasUsd) deckLowestPriceCardMap[c.name] = cheapestUsd[c.name] ?? null
      if (hasEur) deckLowestPriceCardMapEur[c.name] = cheapestEur[c.name] ?? null
      if (hasTix) deckLowestPriceCardMapTix[c.name] = cheapestTix[c.name] ?? null
    }),
  )

  // Also include primer-referenced cards so [[Card Name]] links resolve at runtime
  if (deckData.primer) {
    for (const name of extractPrimerCardNames(deckData.primer)) {
      const canonical = (await ctx.resolveCardName(name.toLowerCase())) ?? name
      if (!(canonical in deckCardMap)) {
        deckCardMap[canonical] = cardData.cards[canonical] ?? null
      }
      if (!(canonical in deckPrintingsMap)) {
        // The card's actual Scryfall name may differ from the primer key (e.g. different
        // punctuation), so also check the prefetched printings under the card's real name.
        const actualName = deckCardMap[canonical]?.name ?? canonical
        deckPrintingsMap[canonical] =
          cardData.printings[canonical] ?? cardData.printings[actualName] ?? []
      }
    }
  }

  // Also include changelog-referenced cards so change history card links resolve at runtime
  for (const name of extractChangelogCardNames(changelog)) {
    const canonical = (await ctx.resolveCardName(name.toLowerCase())) ?? name
    if (!(canonical in deckCardMap)) {
      deckCardMap[canonical] = cardData.cards[canonical] ?? null
    }
    if (!(canonical in deckPrintingsMap)) {
      const actualName = deckCardMap[canonical]?.name ?? canonical
      deckPrintingsMap[canonical] =
        cardData.printings[canonical] ?? cardData.printings[actualName] ?? []
    }
  }

  // Collect missing cards for this deck
  const deckMissingCards: Partial<Record<PriceCurrency, string[]>> = {}
  for (const cur of availableCurrencies) {
    const missing = Array.from(cardData.missing[cur] ?? []).filter((name) =>
      deckData.sections.some((s) => s.cards.some((c) => c.name === name)),
    )
    if (missing.length > 0) {
      deckMissingCards[cur] = missing
    }
  }

  // Every printing a deck tile can display: the entry's own printing when it is
  // pinned (what `resolveEntryCard` shows), the by-name representative
  // otherwise, and the cheapest-printing objects the "Lowest Price" toggle
  // swaps in. That toggle changes the displayed printing, and a client reading
  // baked quotes cannot fetch the one it would then need.
  const buylistSources: BuylistBakeSource[] = []
  if (ctx.buylist) {
    for (const section of deckData.sections) {
      for (const entry of section.cards) {
        if (pricesAtNothing(entry)) continue
        const candidates: (ScryfallCard | null | undefined)[] = [
          hasSpecificPrinting(entry)
            ? findPrinting(deckPrintingsMap[entry.name], entry.set, entry.collectorNumber)
            : undefined,
          deckCardMap[entry.name],
          deckLowestPriceCardMap[entry.name],
          deckLowestPriceCardMapEur[entry.name],
          deckLowestPriceCardMapTix[entry.name],
        ]
        for (const card of candidates) {
          if (card) buylistSources.push({ card, finish: entry.finish, language: entry.language })
        }
      }
    }
  }

  // Custom art rides on the card lines themselves (a deck detail ships the deck,
  // not a separate entry list). A deck with no art is passed through by
  // identity, so it is baked byte for byte as before.
  const hasArt = loaded.art !== undefined && loaded.art.size > 0
  const bakedDeck: BakedDeckData = hasArt ? withDeckCustomArt(deckData, customArtFor) : deckData

  // cardId is shipped on each public-site card so the trade page can
  // encode deck cards into shareable URLs.
  const detail: DeckDetail = {
    deck: bakedDeck,
    labels: loaded.labels,
    cards: deckCardMap,
    printings: deckPrintingsMap,
    lowestPriceCards: hasUsd ? deckLowestPriceCardMap : undefined,
    lowestPriceCardsEur: hasEur ? deckLowestPriceCardMapEur : undefined,
    lowestPriceCardsTix: hasTix ? deckLowestPriceCardMapTix : undefined,
    symbolMap: ctx.symbolMap,
    useScryfallImgUrls,
    defaultCurrency,
    availableCurrencies,
    missingCards: deckMissingCards,
    pricesDate: ctx.pricesDate,
    changelog: changelog.length > 0 ? changelog : undefined,
    buylist: bakeBuylistQuotes(ctx, buylistSources),
  }

  // Build summary for index. Card count is the total quantity of cards in
  // the main deck (commander/oathbreaker + mainboard) so format checks like
  // "100 for Commander" or "60 for Modern" line up with the expected size.
  const cardCount = getMainDeckSize(deckData.sections)
  const format = resolveDeckFormat(deckData)
  const latestChangelog = changelog[0]?.timestamp
  const lastUpdatedAt = latestChangelog ?? fileMtime
  const featuredImage = featured
    ? resolveCardImageSources(featured, useScryfallImgUrls).frontImage
    : ''

  // Compute deck prices (mainboard + sideboard + commander, not extras)
  let deckTotalPrice = 0
  let deckLowestPrice = 0
  let deckTotalPriceEur = 0
  let deckLowestPriceEur = 0
  let deckTotalPriceTix = 0
  let deckLowestPriceTix = 0
  let missingPriceCount = 0
  let missingPriceCountEur = 0
  let missingPriceCountTix = 0
  for (const section of deckData.sections) {
    const sLow = section.name.toLowerCase()
    if (sLow.includes('maybeboard') || sLow.includes('token')) continue
    for (const c of section.cards) {
      // A proxy and a custom-art copy are worth nothing and are not cards whose
      // price is *missing*, so they leave the totals and the missing counts
      // untouched.
      if (pricesAtNothing(c)) continue
      if (hasUsd) {
        const defaultCard = cardData.cards[c.name]
        const cheapCard = cheapestUsd[c.name]
        const cardPrice = parseFloat(defaultCard?.prices.usd || '0')
        deckTotalPrice += cardPrice * c.quantity
        deckLowestPrice += parseFloat(cheapCard?.prices.usd || '0') * c.quantity
        if (!defaultCard?.prices.usd) missingPriceCount += c.quantity
      }
      if (hasEur) {
        const defaultCard = cardData.cards[c.name]
        const cheapCard = cheapestEur[c.name]
        const cardPrice = defaultCard ? getCardPrice(defaultCard, 'eur') : 0
        deckTotalPriceEur += cardPrice * c.quantity
        deckLowestPriceEur += (cheapCard ? getCardPrice(cheapCard, 'eur') : 0) * c.quantity
        if (cardPrice === 0) missingPriceCountEur += c.quantity
      }
      if (hasTix) {
        const defaultCard = cardData.cards[c.name]
        const cheapCard = cheapestTix[c.name]
        const cardPrice = defaultCard ? getCardPrice(defaultCard, 'tix') : 0
        deckTotalPriceTix += cardPrice * c.quantity
        deckLowestPriceTix += (cheapCard ? getCardPrice(cheapCard, 'tix') : 0) * c.quantity
        if (cardPrice === 0) missingPriceCountTix += c.quantity
      }
    }
  }

  const summary: DeckSummary = {
    slug,
    name: deckData.name,
    featuredCardImage: featuredImage,
    commander: featured && commanderSection ? featured.name : null,
    format,
    cardCount,
    lastUpdatedAt,
    totalPrice: hasUsd ? deckTotalPrice : undefined,
    lowestPrice: hasUsd ? deckLowestPrice : undefined,
    totalPriceEur: hasEur ? deckTotalPriceEur : undefined,
    lowestPriceEur: hasEur ? deckLowestPriceEur : undefined,
    totalPriceTix: hasTix ? deckTotalPriceTix : undefined,
    lowestPriceTix: hasTix ? deckLowestPriceTix : undefined,
    missingPriceCount: hasUsd ? missingPriceCount : undefined,
    missingPriceCountEur: hasEur ? missingPriceCountEur : undefined,
    missingPriceCountTix: hasTix ? missingPriceCountTix : undefined,
  }

  return { slug, detail, summary }
}
