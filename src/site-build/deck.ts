import path from 'node:path'
import { loadDeckFile } from '../importers/text-file'
import { parseDeckFrontMatter } from '../list/deck-file'
import { extractChangelogCardNames } from '../changes/changelog-parser'
import type { ChangelogPage } from '../changes/changelog-parser'
import { effectiveLabels, isPriceless, type CardLabel } from '../card/card-labels'
import type { CardArtMap } from '../list/card-art'
import { isListImageCardRef, type ListImageRef } from '../list/list-image'
import { extractPrimerCardNames } from '../list/primer-parser'
import { resolveDeckFormat, getMainDeckSize, isCommanderSection } from '../list/deck-format'
import { findPrinting, hasSpecificPrinting } from '../card/card-printing'
import { printingKey } from '../card/printing-key'
import { printingLabel } from '../card/card-line-tail'
import { getCardPrice } from '../pricing/price-currency'
import type { PriceCurrency } from '../pricing/price-currency'
import { getErrorMessage } from '../util/errors'
import type { Card } from '../card/card'
import type { DeckData } from '../list/deck'
import type { ScryfallCard } from '../scryfall/types'
import type { BakedDeckData, CardKingdomCards, DeckDetail, DeckSummary } from '../list/site-data'
import {
  bakeBuylistQuotes,
  cardIdsOf,
  customArtLookup,
  loadListSidecars,
  readDroppedFrontMatterAdvisories,
  reportListCoverIssue,
  resolveListCover,
  slugifyListName,
} from './shared'
import type { BuylistBakeSource, CustomArtLookup, ListCoverOverrideEntry } from './shared'
import type { DeckArtifacts, SiteDetailContext } from './types'

export type LoadedDeck = {
  data: DeckData
  changelog: ChangelogPage[]
  /** The deck's default card labels from its front matter, when declared. */
  labels?: CardLabel[]
  /**
   * The deck's cover image override from its front matter, when it declares a
   * usable one. An unreadable `image:` value is already reported as one of
   * {@link LoadedDeck.warnings} by the deck parser.
   */
  image?: ListImageRef
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
  let image: ListImageRef | undefined
  let droppedAdvisories: string[] = []
  try {
    const parsed = await loadDeckFile(filePath)
    data = parsed.deck
    warnings = parsed.warnings
    // The deck's label default and its cover override both live in front
    // matter, which the deck parser does not project onto DeckData; the site
    // resolves each line against the labels and picks the cover below. Read
    // once — the file is already on disk and validated by the same call.
    const frontMatter = await parseDeckFrontMatter(filePath)
    labels = frontMatter.labels
    image = frontMatter.image
    // `validateDeckFrontMatter` drops an `image:` or a `description:` its
    // grammar cannot read, and the deck's next whole-file save then deletes the
    // key outright — so the raw values are read back and reported here, exactly
    // as the flat-list loaders report theirs. Paid only by a deck missing one of
    // them, which is every deck that set neither.
    if (image === undefined || frontMatter.description === undefined) {
      droppedAdvisories = await readDroppedFrontMatterAdvisories(filePath)
    }
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

  return {
    data,
    changelog,
    labels,
    image,
    art,
    // One channel for everything the user must hear about, in the order it was
    // discovered: unreadable lines, an ignored front-matter key, then the art
    // sidecar's.
    warnings: [...warnings, ...droppedAdvisories, ...artWarnings],
    fileMtime,
  }
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
  // Only USD has a store choice, so CK's picks ride along with the USD maps and
  // are dropped entirely when the site is not building USD at all.
  const cardKingdomData = hasUsd ? cardData.cardKingdom : undefined

  /**
   * The printing a deck line stands for: its own when it pins one, the by-name
   * representative otherwise. This is what `resolveEntryCard` shows on the deck
   * page, so it is also the art the deck's tile must wear — a commander pinned
   * to a particular printing is that printing everywhere or nowhere. A pin that
   * resolves to nothing falls back rather than blanking the tile.
   *
   * Language-blind on purpose: a deck detail keys its cards by name only (no
   * `set:cn@lang` entries, unlike a collection or wanted list), so the
   * default-language object is the only one a deck can display.
   *
   * Safe to call repeatedly: the unresolvable-pin warning is emitted once per
   * distinct pin, so the several lines that may name one are one message.
   */
  const warnedPins = new Set<string>()
  const entryCard = (entry: Card): ScryfallCard | null => {
    if (hasSpecificPrinting(entry)) {
      const pinned = findPrinting(cardData.printings[entry.name], entry.set, entry.collectorNumber)
      if (pinned) return pinned
      const pin = `${entry.name}|${printingKey(entry.set, entry.collectorNumber)}`
      if (!warnedPins.has(pin)) {
        warnedPins.add(pin)
        ctx.warn?.(
          `  ⚠️  Could not find printing for '${entry.name}' (${printingLabel(entry.set, entry.collectorNumber)})`,
        )
      }
    }
    return cardData.cards[entry.name] ?? null
  }

  // The prefetch caches an image for each name's *representative* printing, so
  // every pinned line's own printing has to be shipped for its art (and its
  // symbols) to exist locally — the same thing the collection and wanted
  // builders do for their exact printings. Deduped by id: a printing named by
  // several lines is one download.
  const shippedPrintings = new Set<string>()
  const shipPinned = async (card: ScryfallCard, entry: Card): Promise<void> => {
    if (card.id === cardData.cards[entry.name]?.id) return
    if (shippedPrintings.has(card.id)) return
    shippedPrintings.add(card.id)
    await ctx.onCardShipped?.(card)
  }

  // Find Featured Card. Every line is resolved to the printing it stands for —
  // the same pass ships pinned printings and picks the fallback featured card.
  const commanderSection = deckData.sections.find((s) => isCommanderSection(s.name))
  const commanderEntry = commanderSection?.cards[0]
  let commanderCard: ScryfallCard | null = null
  let priciest: ScryfallCard | null = null
  let priciestEntry: Card | null = null
  let maxPrice = -1
  for (const section of deckData.sections) {
    for (const entry of section.cards) {
      const card = entryCard(entry)
      if (!card) continue
      await shipPinned(card, entry)
      if (entry === commanderEntry) commanderCard = card
      const price = parseFloat(card.prices.usd || '0')
      if (price > maxPrice) {
        maxPrice = price
        priciest = card
        priciestEntry = entry
      }
    }
  }

  // The commander when the deck names one the build could resolve; otherwise
  // the deck's priciest line, which is a tile image and not a commander — hence
  // the two facts stay separate rather than being re-derived from each other.
  // The line is carried alongside its card because the tile's art is the
  // *line's*: custom art overrides the printing here exactly as it does on the
  // deck page.
  const featured: ScryfallCard | null = commanderCard ?? priciest
  const featuredEntry: Card | null = commanderCard ? (commanderEntry ?? null) : priciestEntry

  const slug = slugifyListName(deckData.name)

  // Build deck-specific card map and printings (only cards in this deck)
  const deckCardMap: Record<string, ScryfallCard | null> = {}
  const deckPrintingsMap: Record<string, ScryfallCard[]> = {}
  const deckLowestPriceCardMap: Record<string, ScryfallCard | null> = {}
  const deckLowestPriceCardMapEur: Record<string, ScryfallCard | null> = {}
  const deckLowestPriceCardMapTix: Record<string, ScryfallCard | null> = {}
  // Card Kingdom's own picks for this deck's names, shipped as sparse overrides
  // beside the Scryfall maps: the client reads them only while the USD source
  // is Card Kingdom, and falls back per name to the maps above for anything CK
  // does not stock.
  const deckCardMapCardKingdom: CardKingdomCards = {}
  const deckLowestPriceCardMapCardKingdom: CardKingdomCards = {}
  deckData.sections.forEach((s) =>
    s.cards.forEach((c) => {
      deckCardMap[c.name] = cardData.cards[c.name] ?? null
      if (cardData.printings[c.name]) {
        deckPrintingsMap[c.name] = cardData.printings[c.name]!
      }
      if (hasUsd) deckLowestPriceCardMap[c.name] = cheapestUsd[c.name] ?? null
      if (hasEur) deckLowestPriceCardMapEur[c.name] = cheapestEur[c.name] ?? null
      if (hasTix) deckLowestPriceCardMapTix[c.name] = cheapestTix[c.name] ?? null
      // Keyed only for names some line leaves unpinned — the same rule the
      // wanted builder applies. A line that names its printing displays that
      // printing under every store, and a by-name override for it could only
      // ever displace it somewhere the pin is not consulted (the card modal).
      const ckCard = hasSpecificPrinting(c) ? undefined : cardKingdomData?.cards[c.name]
      if (ckCard) deckCardMapCardKingdom[c.name] = ckCard
      // The cheapest map has no such carve-out: the "Lowest Price" toggle
      // deliberately ignores an entry's own printing for every line.
      const ckCheapest = cardKingdomData?.cheapest[c.name]
      if (ckCheapest) deckLowestPriceCardMapCardKingdom[c.name] = ckCheapest
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
        const candidates: readonly (ScryfallCard | null | undefined)[] = [
          // The one rule for what a line displays, shared with the tile above:
          // a second spelling of it here could quote a printing the page never
          // shows (and leave the one it does show unquoted).
          entryCard(entry),
          deckLowestPriceCardMap[entry.name],
          deckLowestPriceCardMapEur[entry.name],
          deckLowestPriceCardMapTix[entry.name],
          // The CK source swaps the displayed printing too, and its quote is
          // where the price on the tile comes from — an unquoted CK pick would
          // display at $0, which is exactly the bug the pick exists to fix.
          deckCardMapCardKingdom[entry.name],
          deckLowestPriceCardMapCardKingdom[entry.name],
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
    ...(Object.keys(deckCardMapCardKingdom).length > 0
      ? { cardsCardKingdom: deckCardMapCardKingdom }
      : {}),
    lowestPriceCards: hasUsd ? deckLowestPriceCardMap : undefined,
    lowestPriceCardsEur: hasEur ? deckLowestPriceCardMapEur : undefined,
    lowestPriceCardsTix: hasTix ? deckLowestPriceCardMapTix : undefined,
    ...(Object.keys(deckLowestPriceCardMapCardKingdom).length > 0
      ? { lowestPriceCardsCardKingdom: deckLowestPriceCardMapCardKingdom }
      : {}),
    symbolMap: ctx.symbolMap,
    useScryfallImgUrls,
    defaultCurrency,
    availableCurrencies,
    missingCards: deckMissingCards,
    pricesDate: ctx.pricesDate,
    changelog: changelog.length > 0 ? changelog : undefined,
    buylist: bakeBuylistQuotes(ctx, buylistSources, deckPrintingsMap),
  }

  // Build summary for index. Card count is the total quantity of cards in
  // the main deck (commander/oathbreaker + mainboard) so format checks like
  // "100 for Commander" or "60 for Modern" line up with the expected size.
  const cardCount = getMainDeckSize(deckData.sections)
  const format = resolveDeckFormat(deckData)
  const latestChangelog = changelog[0]?.timestamp
  const lastUpdatedAt = latestChangelog ?? fileMtime
  // The deck's `image:` override, when it names one of its own card lines. A
  // deck has no flat entry list to piggyback on (its cards live in sections and
  // are baked through `withDeckCustomArt`), so the line is found by an explicit
  // walk and resolved through the same `entryCard` the rest of the build uses —
  // a pinned cover is that printing here exactly as it is on the deck page.
  const coverCardId =
    loaded.image && isListImageCardRef(loaded.image) ? loaded.image.card : undefined
  let coverOverride: ListCoverOverrideEntry | undefined
  if (coverCardId !== undefined) {
    const coverEntry = deckData.sections
      .flatMap((section) => section.cards)
      .find((card) => card.cardId === coverCardId)
    if (coverEntry) {
      const art = customArtFor(coverEntry.cardId).customArt
      coverOverride = { card: entryCard(coverEntry), ...(art ? { customArt: art } : {}) }
    }
  }
  const featuredCustomArt = customArtFor(featuredEntry?.cardId).customArt
  const cover = resolveListCover({
    ...(loaded.image ? { image: loaded.image } : {}),
    ...(coverOverride ? { override: coverOverride } : {}),
    featured,
    ...(featuredCustomArt ? { featuredCustomArt } : {}),
    useScryfallImgUrls,
    ...(ctx.missingArtFiles ? { missingArtFiles: ctx.missingArtFiles } : {}),
  })
  reportListCoverIssue(cover, 'deck', deckData.name, ctx)
  const featuredImage = cover.url

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
    // The deck's own commander, never whatever the tile fell back to. Its
    // resolved name when the build has the card, the line's name otherwise.
    commander: commanderEntry ? (commanderCard?.name ?? commanderEntry.name) : null,
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
