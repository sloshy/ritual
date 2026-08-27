import { cardCache, ensureCacheForCards } from '../../cache'
import { detailBuylistContext, getCardKingdomFeed } from '../../cardkingdom'
import { cardKingdomDisplayPrints } from '../../cardkingdom/retail'
import type { PrintingQuoteFn } from '../../cardkingdom/quote'
import { compareData } from '../../i18n/collate'
import { fetchCardData, fetchSymbology, getCardPrintings } from '../../scryfall'
import { computeRepresentativePrints } from '../../scryfall/prices'
import { cardKingdomPricesEnabled, getBannedPrintings } from '../../config/ritual-config'
import { extractChangelogCardNames, parseChangelog } from '../../changes/changelog-parser'
import type { ScryfallCard } from '../../scryfall/types'
import type { PriceCurrency } from '../../pricing/price-currency'
import type { CardKingdomCards } from '../../list/site-data'
import { indexPrintingCard } from '../../editor/card-data-utils'

const ALL_CURRENCIES: PriceCurrency[] = ['usd', 'eur', 'tix']

export type DeckCardLoadResult = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  lowestPriceCards: Record<string, ScryfallCard | null>
  lowestPriceCardsEur: Record<string, ScryfallCard | null>
  lowestPriceCardsTix: Record<string, ScryfallCard | null>
  /**
   * Card Kingdom's own printing picks, exactly as the public site's payloads
   * carry them — sparse, and absent when this deployment does not offer CK
   * prices or has no feed cached. The editors read `cardsCardKingdom` under the
   * CK source, so a name-only line shows the printing CK sells rather than one
   * it never stocked. See {@link CardKingdomCards}.
   */
  cardsCardKingdom?: CardKingdomCards
  /**
   * CK's cheapest printing per name, the counterpart of `lowestPriceCards`.
   * Carried because this response is the client-neutral API surface and the
   * site payloads carry it; the *editors* have no reader for it, since their
   * "Lowest Price" toggle is locked while editing.
   */
  lowestPriceCardsCardKingdom?: CardKingdomCards
}

export type EntryCardLoadResult = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  /**
   * Card Kingdom's picks for the *name* keys, which only a wanted list's
   * name-only entries resolve through — a collection entry names its printing
   * and is never overridden. Absent under the same conditions as
   * {@link DeckCardLoadResult.cardsCardKingdom}.
   */
  cardsCardKingdom?: CardKingdomCards
}

/**
 * The Card Kingdom lookup to pick printings with, or null when this deployment
 * offers no CK prices (or has no feed downloaded). Cache-only, like every other
 * read on the load path: `getCardKingdomFeed` never downloads, so an editor
 * load cannot block on ~70 MB.
 */
async function cardKingdomQuote(): Promise<PrintingQuoteFn | null> {
  if (!cardKingdomPricesEnabled()) return null
  const feed = await getCardKingdomFeed()
  return feed ? detailBuylistContext(feed).quote : null
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
  const ckQuote = await cardKingdomQuote()
  const cardsCardKingdom: CardKingdomCards = {}
  const lowestPriceCardsCardKingdom: CardKingdomCards = {}

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

      // The same picks `build-site` and `serve --api` bake, from the same
      // function — an editor and a published page must not disagree about which
      // printing a name-only line is.
      if (ckQuote) {
        const ckPrints = cardKingdomDisplayPrints(ckQuote, sorted, sorted, bannedPrintings)
        if (ckPrints.representative) cardsCardKingdom[name] = ckPrints.representative
        if (ckPrints.cheapest) lowestPriceCardsCardKingdom[name] = ckPrints.cheapest
      }
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

  return {
    cards,
    printings,
    lowestPriceCards,
    lowestPriceCardsEur,
    lowestPriceCardsTix,
    // Absent when there is nothing to say — this deployment offers no CK prices,
    // has no feed cached, or CK carries no printing of anything in this list.
    // The site payloads spell it the same way, and every client treats a missing
    // key and a missing entry identically (fall back to the Scryfall pick).
    ...(Object.keys(cardsCardKingdom).length > 0 ? { cardsCardKingdom } : {}),
    ...(Object.keys(lowestPriceCardsCardKingdom).length > 0 ? { lowestPriceCardsCardKingdom } : {}),
  }
}

/** Options for {@link loadEntryCardData}. */
export type EntryCardLoadOptions = {
  /**
   * Whether to select Card Kingdom's printings for the card *names*. Only a
   * wanted list's name-only entries resolve that way — a collection entry names
   * its printing — so a collection load passes `false` and skips the scan
   * rather than paying for a map nothing reads.
   */
  cardKingdomPicks?: boolean
}

/** Load card data keyed by name and set:collectorNumber (for collections/wanted lists). */
export async function loadEntryCardData(
  cardNames: Set<string>,
  options: EntryCardLoadOptions = {},
): Promise<EntryCardLoadResult> {
  await ensureCacheForCards(cardNames)

  const bannedPrintings = getBannedPrintings()
  const cards: Record<string, ScryfallCard | null> = {}
  const printings: Record<string, ScryfallCard[]> = {}
  const ckQuote = options.cardKingdomPicks === true ? await cardKingdomQuote() : null
  const cardsCardKingdom: CardKingdomCards = {}

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

      // A wanted list's name-only entry displays the cheapest printing, so CK's
      // cheapest is its override — the rule the wanted detail builder applies.
      if (ckQuote) {
        const ckPrints = cardKingdomDisplayPrints(ckQuote, sorted, sorted, bannedPrintings)
        const ckCard = ckPrints.cheapest ?? ckPrints.representative
        if (ckCard) cardsCardKingdom[name] = ckCard
      }
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

  return {
    cards,
    printings,
    ...(Object.keys(cardsCardKingdom).length > 0 ? { cardsCardKingdom } : {}),
  }
}
