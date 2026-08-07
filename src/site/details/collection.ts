import path from 'node:path'
import fs from 'node:fs/promises'
import { parseCollectionFile } from '../../collection-file'
import type { CollectionEntry } from '../../collection-file'
import type { CardLabel } from '../../card-labels'
import { parseTitleFromContent } from '../../section-format'
import type { ChangelogPage } from '../../changelog-parser'
import { findPrinting } from '../../card-printing'
import { displayLanguage, scryfallCardLanguage } from '../../card-language'
import { displayFinish } from '../../finish-condition'
import { getCardPriceForFinish } from '../../price-currency'
import { resolveCardImageSources } from '../image-sources'
import type { ScryfallCard } from '../../types'
import type { CollectionCardEntry, CollectionDetail, CollectionSummary } from '../data-types'
import {
  includeChangelogCards,
  listReadErrorMessage,
  loadListSidecars,
  slugifyListName,
} from './shared'
import type { SiteDetailContext } from './types'
import { printingKey, printingLanguageKey } from '../../printing-key'

export type LoadedCollection = {
  displayName: string
  entries: CollectionEntry[]
  /** Section names in file order, including empty sections. */
  sectionOrder: string[]
  /** The list's default card labels from its front matter, when declared. */
  labels?: CardLabel[]
  warnings: string[]
  changelog: ChangelogPage[]
  fileMtime?: string
}

/**
 * Load a collection markdown file plus its `.changes.md` sidecar. Returns an
 * error message string when the file can't be read.
 */
export async function loadCollectionSource(
  collectionsDir: string,
  name: string,
): Promise<LoadedCollection | string> {
  const fileName = name.endsWith('.md') ? name : `${name}.md`
  const filePath = path.join(collectionsDir, fileName)

  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    // Just the reason: the caller owns the "Failed to load <kind> '<name>'"
    // lead-in, so all three list types report a failed read identically.
    return listReadErrorMessage(error, filePath)
  }

  const { entries, sectionOrder, labels, warnings } = parseCollectionFile(content)
  const displayName = parseTitleFromContent(content) ?? name

  const baseName = name.endsWith('.md') ? name.slice(0, -3) : name
  const { changelog, fileMtime } = await loadListSidecars(collectionsDir, baseName, filePath)

  return { displayName, entries, sectionOrder, labels, warnings, changelog, fileMtime }
}

export type CollectionArtifacts = {
  slug: string
  detail: CollectionDetail
  summary: CollectionSummary
}

/** Build a collection's detail JSON payload and index summary. */
export async function buildCollectionArtifacts(
  loaded: LoadedCollection,
  ctx: SiteDetailContext,
): Promise<CollectionArtifacts> {
  const { displayName, entries, sectionOrder, changelog, fileMtime } = loaded

  // Resolve exact printings for each entry
  const cardMap: Record<string, ScryfallCard | null> = {}
  const printingsMap: Record<string, ScryfallCard[]> = {}
  const cardEntries: CollectionCardEntry[] = []
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
    const cardKey = printingKey(entry.set, entry.collectorNumber)

    if (!cardMap[cardKey]) {
      // Try to find exact printing
      const printings = await ctx.getPrintings(entry.name)
      if (!printingsMap[entry.name]) {
        printingsMap[entry.name] = printings
      }
      const exactPrinting = findPrinting(printings, entry.set, entry.collectorNumber)

      if (exactPrinting) {
        cardMap[cardKey] = exactPrinting
        await ctx.onCardShipped?.(exactPrinting)
      } else {
        ctx.warn?.(
          `  ⚠️  Could not find printing for '${entry.name}' (${entry.set.toUpperCase()}:${entry.collectorNumber})`,
        )
        cardMap[cardKey] = null
      }
    }

    // Bake the alternate-language card object for non-en entries under its
    // `set:cn@lang` key, beside the plain key's default-language object. The
    // page's `lookupPrintingCard` reads the `@lang` key first, so a `[ja]` line
    // shows the ja scan while pricing still comes from the default object. No
    // explicit-null is written on a miss — falling through to the plain key's
    // default-language object is the right degraded rendering, and the price
    // beside it is that object's anyway.
    const language = displayLanguage(entry.language)
    if (language !== 'en') {
      const langKey = printingLanguageKey(entry.set, entry.collectorNumber, language)
      if (!cardMap[langKey]) {
        const printings =
          printingsMap[entry.name] ??
          (printingsMap[entry.name] = await ctx.getPrintings(entry.name))
        const langCard = findPrinting(printings, entry.set, entry.collectorNumber, language)
        if (langCard && scryfallCardLanguage(langCard) === language) {
          cardMap[langKey] = langCard
          await ctx.onCardShipped?.(langCard)
        } else {
          ctx.warn?.(
            `  ⚠️  No ${language} card object for '${entry.name}' (${entry.set.toUpperCase()}:${entry.collectorNumber}); using the default-language object`,
          )
        }
      }
    }

    const card = cardMap[cardKey] ?? null
    const finish = displayFinish(card, entry.finish)
    const price = card ? getCardPriceForFinish(card, finish, 'usd') : 0
    const priceEur = card ? getCardPriceForFinish(card, finish, 'eur') : 0
    const priceTix = card ? getCardPriceForFinish(card, finish, 'tix') : 0
    totalPrice += price
    totalPriceEur += priceEur
    totalPriceTix += priceTix
    if (price === 0) missingPriceCount++
    if (priceEur === 0) missingPriceCountEur++
    if (priceTix === 0) missingPriceCountTix++

    if (card && price > featuredPrice) {
      featuredPrice = price
      featured = card
    }

    cardEntries.push({
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish,
      condition: entry.condition ?? 'NM',
      language: entry.language,
      labels: entry.labels,
      price,
      fileOrder: i,
      section: entry.section,
      note: entry.note,
      cardId: entry.cardId,
    })
  }

  const slug = slugifyListName(displayName)

  // Include changelog-referenced cards in the card maps
  await includeChangelogCards(changelog, cardMap, printingsMap, ctx)

  const detail: CollectionDetail = {
    name: displayName,
    entries: cardEntries,
    sectionOrder,
    labels: loaded.labels,
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

  const summary: CollectionSummary = {
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
    labels: loaded.labels,
  }

  return { slug, detail, summary }
}
