import { t } from '../i18n/t'
import { parseWantedListFile } from '../list/wanted-file'
import type { WantedListEntry } from '../list/wanted-file'
import { findPrinting, hasSpecificPrinting } from '../card/card-printing'
import { displayLanguage, scryfallCardLanguage } from '../card/card-language'
import { displayFinish } from '../card/finish-condition'
import { getCardPrice, getCardPriceForFinish } from '../pricing/price-currency'
import { isListImageCardRef } from '../list/list-image'
import type { ScryfallCard } from '../scryfall/types'
import type {
  CardKingdomCards,
  WantedListCardEntry,
  WantedListDetail,
  WantedListEntryState,
  WantedListSummary,
} from '../list/site-data'
import {
  bakeBuylistQuotes,
  bakedListCategoryFields,
  cardCategoriesLookup,
  customArtLookup,
  includeChangelogCards,
  loadFlatListSource,
  reportListCoverIssue,
  resolveListCover,
  siteCardKingdomData,
  slugifyListName,
} from './shared'
import type { BuylistBakeSource, ListCoverOverrideEntry, LoadedFlatList } from './shared'
import type { SiteDetailContext, WantedArtifacts } from './types'
import {
  flatListStores,
  sumStorePrices,
  summaryPriceFields,
  type CheapestByCurrency,
  type FlatSummaryLine,
} from './summary-prices'
import { cardPrintingKey, printingKey, printingLanguageKey } from '../card/printing-key'
import { printingLabel } from '../card/card-line-tail'

export type LoadedWanted = LoadedFlatList<WantedListEntry>

export function loadWantedSource(dir: string, name: string): Promise<LoadedWanted | string> {
  return loadFlatListSource(dir, name, parseWantedListFile)
}

/** Build a wanted list's detail JSON payload and index summary. */
export async function buildWantedArtifacts(
  loaded: LoadedWanted,
  ctx: SiteDetailContext,
): Promise<WantedArtifacts> {
  const { displayName, entries, sectionOrder, changelog, fileMtime } = loaded
  const { cardData, availableCurrencies } = ctx
  const hasUsd = availableCurrencies.includes('usd')
  const cheapestUsdMap = cardData.cheapest.usd ?? {}
  const cheapestEurMap = cardData.cheapest.eur ?? {}
  const cheapestTixMap = cardData.cheapest.tix ?? {}

  const cardMap: Record<string, ScryfallCard | null> = {}
  // Card Kingdom's pick for the name-only entries, keyed by card name — the only
  // key `resolveWantedCardEntry` consults for them. Pinned entries are left out
  // on purpose: a line that names its printing displays that printing under
  // every store.
  const cardMapCardKingdom: CardKingdomCards = {}
  const cardKingdomData = siteCardKingdomData(ctx)
  // Each counted entry, summed per store once the buylist quotes are baked
  // (below), so Card Kingdom prices from the very quotes the page reads.
  const summaryLines: FlatSummaryLine[] = []
  const printingsMap: Record<string, ScryfallCard[]> = {}
  const cardEntries: WantedListCardEntry[] = []
  let featured: ScryfallCard | null = null
  let featuredPrice = -1
  /** The featured entry's card id, for the custom art its cover may wear. */
  let featuredCardId: number | undefined
  /** Every entry's displayed printing, for the buylist bake (empty when not baking). */
  const buylistSources: BuylistBakeSource[] = []
  const customArtFor = customArtLookup(loaded.art, ctx)
  const cardCategoriesFor = cardCategoriesLookup(loaded.cardCategories)
  /**
   * The `&N` the list's `image:` override names, when it names one. Captured
   * from the walk below rather than by a second pass: the entry's printing is
   * resolved there once, and the cover has to be the very printing the list
   * page shows for that line.
   */
  const coverCardId =
    loaded.image && isListImageCardRef(loaded.image) ? loaded.image.card : undefined
  let coverOverride: ListCoverOverrideEntry | undefined

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!

    // Determine state
    let state: WantedListEntryState
    if (!entry.set || !entry.collectorNumber) {
      state = 'name-only'
    } else if (!entry.finish) {
      state = 'printing'
    } else {
      state = 'fully-specified'
    }

    // Ensure printings are fetched
    if (!printingsMap[entry.name]) {
      const printings = await ctx.getPrintings(entry.name)
      printingsMap[entry.name] = printings
    }
    const printings = printingsMap[entry.name]!

    // The entry's own USD price, baked onto it for the page; the summary's
    // per-store figures are summed from `summaryLines` instead.
    let price = 0
    let card: ScryfallCard | null = null
    /** The per-currency cheapest printings a name-only entry is priced at; pinned entries have none. */
    let cheapest: CheapestByCurrency | undefined

    // Branch on the guard rather than on `state`: it narrows `entry.set` and
    // `entry.collectorNumber` to `string`, which the `state` ladder cannot.
    if (!hasSpecificPrinting(entry)) {
      // Use cheapest printing for wanted list entries
      const cheapUsd = cheapestUsdMap[entry.name]
      const cheapEur = cheapestEurMap[entry.name]
      const cheapTix = cheapestTixMap[entry.name]
      card = cheapUsd ?? cheapEur ?? cheapTix ?? cardData.cards[entry.name] ?? null
      if (card) {
        const cardKey = cardPrintingKey(card)
        cardMap[cardKey] = card
        cardMap[entry.name] = card

        // The CK counterpart of the cheapest-printing pick above: the cheapest
        // printing Card Kingdom actually sells, falling back to its
        // representative when CK has no cheapest to offer.
        const ckCard = cardKingdomData?.cheapest[entry.name] ?? cardKingdomData?.cards[entry.name]
        if (ckCard) cardMapCardKingdom[entry.name] = ckCard

        cheapest = { usd: cheapUsd, eur: cheapEur, tix: cheapTix }
        if (hasUsd) price = getCardPrice(cheapUsd ?? card, 'usd')
      }
    } else {
      // State 2 or 3: find exact printing
      const exactPrinting = findPrinting(printings, entry.set, entry.collectorNumber)
      const cardKey = printingKey(entry.set, entry.collectorNumber)

      if (exactPrinting) {
        card = exactPrinting
        cardMap[cardKey] = exactPrinting
        cardMap[entry.name] = cardMap[entry.name] ?? exactPrinting

        await ctx.onCardShipped?.(exactPrinting)

        // Bake the alternate-language object for a `[ja]` line under its
        // `set:cn@lang` key (see the collection builder for the full rationale).
        // A miss is left unkeyed so lookups fall through to the default object.
        const language = displayLanguage(entry.language)
        if (language !== 'en') {
          const langKey = printingLanguageKey(entry.set, entry.collectorNumber, language)
          if (!cardMap[langKey]) {
            const langCard = findPrinting(printings, entry.set, entry.collectorNumber, language)
            if (langCard && scryfallCardLanguage(langCard) === language) {
              cardMap[langKey] = langCard
              await ctx.onCardShipped?.(langCard)
            } else {
              ctx.warn?.(
                `  ⚠️  ${t('site.detail.noLanguageCard', {
                  language,
                  name: entry.name,
                  printing: printingLabel(entry.set, entry.collectorNumber),
                })}`,
              )
            }
          }
        }

        if (hasUsd) {
          price = getCardPriceForFinish(
            exactPrinting,
            displayFinish(exactPrinting, entry.finish),
            'usd',
          )
        }
      } else {
        ctx.warn?.(
          `  ⚠️  Could not find printing for '${entry.name}' (${printingLabel(entry.set, entry.collectorNumber)})`,
        )
        cardMap[cardKey] = null
      }
    }

    // A copy wearing custom art is no longer the printing a price would be for:
    // it is worth nothing in every currency, counts toward no shortfall, and is
    // offered to no buyer. Wanted lines carry no labels, so custom art is the
    // only way a wanted entry can be priceless. Judged by the sidecar
    // *reference*, not by the display URL beside it: a reference whose file the
    // build could not deploy shows the card's real art and must still price at
    // nothing, exactly as `ritual price` reads it.
    const art = customArtFor(entry.cardId)
    const priceless = art.hasCustomArt === true
    // The printing's own price, before pricelessness is applied. The list's
    // totals use the baked zero; the cover pick below ranks by this, so a
    // custom-art copy can still be the list's face — the same way a deck's
    // commander takes the cover whatever it is worth.
    const printingPrice = price
    if (priceless) {
      price = 0
    } else {
      const pinned = hasSpecificPrinting(entry)
      summaryLines.push({
        quantity: 1,
        pinned,
        card,
        ...(cheapest ? { cheapest } : {}),
        finish: entry.finish,
        language: entry.language,
        // The printing the Card Kingdom view shows: the pin, else CK's own pick.
        ckCard: pinned ? card : (cardMapCardKingdom[entry.name] ?? card),
      })
      // `card` is what `resolveWantedCardEntry` will hand the tile: the exact
      // printing when the line pins one, the cheapest/representative otherwise.
      // Under the CK source the tile shows CK's own pick instead, and its price
      // is read off these very quotes — so that printing is quoted too.
      if (ctx.buylist) {
        buylistSources.push({ card, finish: entry.finish, language: entry.language })
        const ckCard = cardMapCardKingdom[entry.name]
        if (ckCard && ckCard !== card) {
          buylistSources.push({ card: ckCard, finish: entry.finish, language: entry.language })
        }
      }
    }

    if (card && printingPrice > featuredPrice) {
      featuredPrice = printingPrice
      featured = card
      featuredCardId = entry.cardId
    }

    if (entry.cardId !== undefined && entry.cardId === coverCardId) {
      coverOverride = { card, ...(art.customArt ? { customArt: art.customArt } : {}) }
    }

    cardEntries.push({
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      language: entry.language,
      tags: entry.tags,
      ...art,
      ...cardCategoriesFor(entry.name),
      price,
      fileOrder: i,
      section: entry.section,
      note: entry.note,
      state,
      cardId: entry.cardId,
    })
  }

  const slug = slugifyListName(displayName)

  // Include changelog-referenced cards
  await includeChangelogCards(changelog, cardMap, printingsMap, ctx)

  const categoryFields = await bakedListCategoryFields(
    loaded.cardCategories,
    loaded.categoryWarnings,
  )

  const detail: WantedListDetail = {
    name: displayName,
    entries: cardEntries,
    sectionOrder,
    ...(loaded.description ? { description: loaded.description } : {}),
    // Baked so a `.md` downloaded from the site re-emits `image:` rather than
    // dropping it — the front matter a browser can rebuild is only what is here.
    ...(loaded.image ? { listImage: loaded.image } : {}),
    cards: cardMap,
    ...(Object.keys(cardMapCardKingdom).length > 0 ? { cardsCardKingdom: cardMapCardKingdom } : {}),
    printings: printingsMap,
    symbolMap: ctx.symbolMap,
    useScryfallImgUrls: ctx.useScryfallImgUrls,
    totalPrice: cardEntries.reduce((sum, entry) => sum + entry.price, 0),
    pricesDate: ctx.pricesDate,
    changelog: changelog.length > 0 ? changelog : undefined,
    ...categoryFields,
    buylist: bakeBuylistQuotes(ctx, buylistSources, printingsMap),
  }

  const featuredCustomArt = customArtFor(featuredCardId).customArt
  const cover = resolveListCover({
    ...(loaded.image ? { image: loaded.image } : {}),
    ...(coverOverride ? { override: coverOverride } : {}),
    featured,
    ...(featuredCustomArt ? { featuredCustomArt } : {}),
    useScryfallImgUrls: ctx.useScryfallImgUrls,
    ...(ctx.missingArtFiles ? { missingArtFiles: ctx.missingArtFiles } : {}),
  })
  reportListCoverIssue(cover, 'wanted', displayName, ctx)
  const featuredImage = cover.url

  const summary: WantedListSummary = {
    slug,
    name: displayName,
    featuredCardImage: featuredImage,
    cardCount: entries.length,
    lastUpdatedAt: changelog[0]?.timestamp ?? fileMtime,
    ...summaryPriceFields(
      sumStorePrices(
        summaryLines,
        // Card Kingdom only when the site offers it (its picks exist exactly then).
        flatListStores(availableCurrencies, detail.buylist, cardKingdomData !== undefined),
      ),
      ['total', 'missing', 'estimated'],
    ),
  }

  return { slug, detail, summary }
}
