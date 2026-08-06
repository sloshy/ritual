import path from 'node:path'
import fs from 'node:fs/promises'
import { parseWantedListFile } from '../../commands/wanted-helpers'
import type { WantedListEntry } from '../../commands/wanted-helpers'
import { parseTitleFromContent } from '../../section-format'
import type { ChangelogPage } from '../../changelog-parser'
import { findPrinting, hasSpecificPrinting } from '../../card-printing'
import { defaultPrintingFinish } from '../../finish-condition'
import { getCardPrice, getCardPriceForFinish } from '../../price-currency'
import { resolveCardImageSources } from '../image-sources'
import type { ScryfallCard } from '../../types'
import type {
  WantedListCardEntry,
  WantedListDetail,
  WantedListEntryState,
  WantedListSummary,
} from '../data-types'
import {
  includeChangelogCards,
  listReadErrorMessage,
  loadListSidecars,
  slugifyListName,
} from './shared'
import type { SiteDetailContext } from './types'
import { cardPrintingKey, formatPrintingLabel, printingKey } from '../../printing-key'

export type LoadedWanted = {
  displayName: string
  entries: WantedListEntry[]
  /** Section names in file order, including empty sections. */
  sectionOrder: string[]
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
  const { changelog, fileMtime } = await loadListSidecars(wantedDir, baseName, filePath)

  return { displayName, entries, sectionOrder, warnings, changelog, fileMtime }
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

        if (hasUsd) {
          const c = cheapUsd ?? card
          price = parseFloat(c.prices.usd || '0')
          if (price === 0) missingPriceCount++
        }
        if (hasEur) {
          const c = cheapEur ?? card
          priceEur = getCardPrice(c, 'eur')
          if (priceEur === 0) missingPriceCountEur++
        }
        if (hasTix) {
          const c = cheapTix ?? card
          priceTix = getCardPrice(c, 'tix')
          if (priceTix === 0) missingPriceCountTix++
        }
      } else {
        missingPriceCount++
        missingPriceCountEur++
        missingPriceCountTix++
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

        if (entry.finish) {
          if (hasUsd) {
            price = getCardPriceForFinish(exactPrinting, entry.finish, 'usd')
            if (price === 0) missingPriceCount++
          }
          if (hasEur) {
            priceEur = getCardPriceForFinish(exactPrinting, entry.finish, 'eur')
            if (priceEur === 0) missingPriceCountEur++
          }
          if (hasTix) {
            priceTix = getCardPriceForFinish(exactPrinting, entry.finish, 'tix')
            if (priceTix === 0) missingPriceCountTix++
          }
        } else {
          // State 2: the printing's default finish (nonfoil when it offers one).
          const defaultFinish = defaultPrintingFinish(exactPrinting)

          if (hasUsd) {
            price = getCardPriceForFinish(exactPrinting, defaultFinish, 'usd')
            if (price === 0) missingPriceCount++
          }
          if (hasEur) {
            priceEur = getCardPriceForFinish(exactPrinting, defaultFinish, 'eur')
            if (priceEur === 0) missingPriceCountEur++
          }
          if (hasTix) {
            priceTix = getCardPriceForFinish(exactPrinting, defaultFinish, 'tix')
            if (priceTix === 0) missingPriceCountTix++
          }
        }
      } else {
        ctx.warn?.(
          `  ⚠️  Could not find printing for '${entry.name}' (${formatPrintingLabel(entry.set, entry.collectorNumber)})`,
        )
        cardMap[cardKey] = null
        missingPriceCount++
        missingPriceCountEur++
        missingPriceCountTix++
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
    printings: printingsMap,
    symbolMap: ctx.symbolMap,
    useScryfallImgUrls: ctx.useScryfallImgUrls,
    totalPrice,
    defaultCurrency: ctx.defaultCurrency,
    pricesDate: ctx.pricesDate,
    changelog: changelog.length > 0 ? changelog : undefined,
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
