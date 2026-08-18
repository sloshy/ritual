import { t } from '../../i18n/t'
import path from 'node:path'
import fs from 'node:fs/promises'
import { parseWantedListFile } from '../../commands/wanted-helpers'
import type { WantedListEntry } from '../../commands/wanted-helpers'
import { parseTitleFromContent } from '../../section-format'
import type { ChangelogPage } from '../../changelog-parser'
import { findPrinting, hasSpecificPrinting } from '../../card-printing'
import { displayLanguage, scryfallCardLanguage } from '../../card-language'
import { defaultPrintingFinish } from '../../finish-condition'
import { getCardPrice, getCardPriceForFinish } from '../../price-currency'
import { resolveCardImageSources } from '../image-sources'
import type { CardArtMap } from '../../card-art'
import type { ScryfallCard } from '../../types'
import type {
  CardKingdomCards,
  WantedListCardEntry,
  WantedListDetail,
  WantedListEntryState,
  WantedListSummary,
} from '../data-types'
import {
  bakeBuylistQuotes,
  cardIdsOf,
  customArtLookup,
  includeChangelogCards,
  listReadErrorMessage,
  loadListSidecars,
  slugifyListName,
} from './shared'
import type { BuylistBakeSource } from './shared'
import type { SiteDetailContext } from './types'
import {
  cardPrintingKey,
  formatPrintingLabel,
  printingKey,
  printingLanguageKey,
} from '../../printing-key'

export type LoadedWanted = {
  displayName: string
  entries: WantedListEntry[]
  /** Section names in file order, including empty sections. */
  sectionOrder: string[]
  /** Custom art from the `.art.json` sidecar, keyed by card id. */
  art?: CardArtMap
  warnings: string[]
  changelog: ChangelogPage[]
  fileMtime?: string
}

/**
 * Load a wanted list markdown file plus its `.changes.md` sidecar. Returns an
 * error message string when the file can't be read.
 */
export async function loadWantedSource(
  wantedDir: string,
  name: string,
): Promise<LoadedWanted | string> {
  const fileName = name.endsWith('.md') ? name : `${name}.md`
  const filePath = path.join(wantedDir, fileName)

  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    // Just the reason: the caller owns the "Failed to load <kind> '<name>'"
    // lead-in, so all three list types report a failed read identically.
    return listReadErrorMessage(error, filePath)
  }

  const { entries, sectionOrder, warnings } = parseWantedListFile(content)
  const displayName = parseTitleFromContent(content) ?? name

  const baseName = name.endsWith('.md') ? name.slice(0, -3) : name
  const { changelog, fileMtime, art, artWarnings } = await loadListSidecars(
    wantedDir,
    baseName,
    filePath,
    { knownCardIds: cardIdsOf(entries) },
  )

  return {
    displayName,
    entries,
    sectionOrder,
    art,
    warnings: [...warnings, ...artWarnings],
    changelog,
    fileMtime,
  }
}

export type WantedArtifacts = {
  slug: string
  detail: WantedListDetail
  summary: WantedListSummary
}

/** Build a wanted list's detail JSON payload and index summary. */
export async function buildWantedArtifacts(
  loaded: LoadedWanted,
  ctx: SiteDetailContext,
): Promise<WantedArtifacts> {
  const { displayName, entries, sectionOrder, changelog, fileMtime } = loaded
  const { cardData, availableCurrencies } = ctx
  const hasUsd = availableCurrencies.includes('usd')
  const hasEur = availableCurrencies.includes('eur')
  const hasTix = availableCurrencies.includes('tix')
  const cheapestUsdMap = cardData.cheapest.usd ?? {}
  const cheapestEurMap = cardData.cheapest.eur ?? {}
  const cheapestTixMap = cardData.cheapest.tix ?? {}

  const cardMap: Record<string, ScryfallCard | null> = {}
  // Card Kingdom's pick for the name-only entries, keyed by card name — the only
  // key `resolveWantedCardEntry` consults for them. Pinned entries are left out
  // on purpose: a line that names its printing displays that printing under
  // every store.
  const cardMapCardKingdom: CardKingdomCards = {}
  const cardKingdomData = hasUsd ? cardData.cardKingdom : undefined
  const printingsMap: Record<string, ScryfallCard[]> = {}
  const cardEntries: WantedListCardEntry[] = []
  let totalPrice = 0
  let totalPriceEur = 0
  let totalPriceTix = 0
  let missingPriceCount = 0
  let missingPriceCountEur = 0
  let missingPriceCountTix = 0
  let featured: ScryfallCard | null = null
  let featuredPrice = -1
  /** Every entry's displayed printing, for the buylist bake (empty when not baking). */
  const buylistSources: BuylistBakeSource[] = []
  const customArtFor = customArtLookup(loaded.art, ctx)

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

    let price = 0
    let priceEur = 0
    let priceTix = 0
    let card: ScryfallCard | null = null
    // Counted per entry and folded into the list's totals below, because a copy
    // wearing custom art is not a card whose price is *missing* — it is a card
    // that has no price to look up. The pricing branches below are unchanged;
    // whether their answer counts is decided in one place.
    let missingUsd = 0
    let missingEur = 0
    let missingTix = 0

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

        if (hasUsd) {
          const c = cheapUsd ?? card
          price = parseFloat(c.prices.usd || '0')
          if (price === 0) missingUsd++
        }
        if (hasEur) {
          const c = cheapEur ?? card
          priceEur = getCardPrice(c, 'eur')
          if (priceEur === 0) missingEur++
        }
        if (hasTix) {
          const c = cheapTix ?? card
          priceTix = getCardPrice(c, 'tix')
          if (priceTix === 0) missingTix++
        }
      } else {
        missingUsd++
        missingEur++
        missingTix++
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
                  printing: formatPrintingLabel(entry.set, entry.collectorNumber),
                })}`,
              )
            }
          }
        }

        if (entry.finish) {
          if (hasUsd) {
            price = getCardPriceForFinish(exactPrinting, entry.finish, 'usd')
            if (price === 0) missingUsd++
          }
          if (hasEur) {
            priceEur = getCardPriceForFinish(exactPrinting, entry.finish, 'eur')
            if (priceEur === 0) missingEur++
          }
          if (hasTix) {
            priceTix = getCardPriceForFinish(exactPrinting, entry.finish, 'tix')
            if (priceTix === 0) missingTix++
          }
        } else {
          // State 2: the printing's default finish (nonfoil when it offers one).
          const defaultFinish = defaultPrintingFinish(exactPrinting)

          if (hasUsd) {
            price = getCardPriceForFinish(exactPrinting, defaultFinish, 'usd')
            if (price === 0) missingUsd++
          }
          if (hasEur) {
            priceEur = getCardPriceForFinish(exactPrinting, defaultFinish, 'eur')
            if (priceEur === 0) missingEur++
          }
          if (hasTix) {
            priceTix = getCardPriceForFinish(exactPrinting, defaultFinish, 'tix')
            if (priceTix === 0) missingTix++
          }
        }
      } else {
        ctx.warn?.(
          `  ⚠️  Could not find printing for '${entry.name}' (${formatPrintingLabel(entry.set, entry.collectorNumber)})`,
        )
        cardMap[cardKey] = null
        missingUsd++
        missingEur++
        missingTix++
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
    if (priceless) {
      price = 0
      priceEur = 0
      priceTix = 0
    } else {
      missingPriceCount += missingUsd
      missingPriceCountEur += missingEur
      missingPriceCountTix += missingTix
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

    totalPrice += price
    totalPriceEur += priceEur
    totalPriceTix += priceTix

    if (card && price > featuredPrice) {
      featuredPrice = price
      featured = card
    }

    cardEntries.push({
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      language: entry.language,
      ...art,
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

  const detail: WantedListDetail = {
    name: displayName,
    entries: cardEntries,
    sectionOrder,
    cards: cardMap,
    ...(Object.keys(cardMapCardKingdom).length > 0 ? { cardsCardKingdom: cardMapCardKingdom } : {}),
    printings: printingsMap,
    symbolMap: ctx.symbolMap,
    useScryfallImgUrls: ctx.useScryfallImgUrls,
    totalPrice,
    defaultCurrency: ctx.defaultCurrency,
    pricesDate: ctx.pricesDate,
    changelog: changelog.length > 0 ? changelog : undefined,
    buylist: bakeBuylistQuotes(ctx, buylistSources, printingsMap),
  }

  const featuredImage = featured
    ? resolveCardImageSources(featured, ctx.useScryfallImgUrls).frontImage
    : ''

  const summary: WantedListSummary = {
    slug,
    name: displayName,
    featuredCardImage: featuredImage,
    cardCount: entries.length,
    lastUpdatedAt: changelog[0]?.timestamp ?? fileMtime,
    totalPrice,
    totalPriceEur,
    totalPriceTix,
    missingPriceCount,
    missingPriceCountEur,
    missingPriceCountTix,
  }

  return { slug, detail, summary }
}
