import { t } from '../../i18n/t'
import path from 'node:path'
import fs from 'node:fs/promises'
import { parseCollectionFile } from '../../collection-file'
import type { CollectionEntry } from '../../collection-file'
import { effectiveLabels, isPriceless, type CardLabel } from '../../card-labels'
import type { CardArtMap } from '../../card-art'
import { isListImageCardRef, readListImage, type ListImageRef } from '../../list-image'
import { parseTitleFromContent } from '../../section-format'
import type { ChangelogPage } from '../../changelog-parser'
import { findPrinting } from '../../card-printing'
import { displayLanguage, scryfallCardLanguage } from '../../card-language'
import { displayFinish } from '../../finish-condition'
import { getCardPriceForFinish } from '../../price-currency'
import type { ScryfallCard } from '../../types'
import type { CollectionCardEntry, CollectionDetail, CollectionSummary } from '../data-types'
import {
  bakeBuylistQuotes,
  cardIdsOf,
  customArtLookup,
  includeChangelogCards,
  listReadErrorMessage,
  loadListSidecars,
  reportListCoverIssue,
  resolveListCover,
  slugifyListName,
} from './shared'
import type { BuylistBakeSource, ListCoverOverrideEntry } from './shared'
import type { SiteDetailContext } from './types'
import { printingKey, printingLanguageKey } from '../../printing-key'

export type LoadedCollection = {
  displayName: string
  entries: CollectionEntry[]
  /** Section names in file order, including empty sections. */
  sectionOrder: string[]
  /** The list's default card labels from its front matter, when declared. */
  labels?: CardLabel[]
  /**
   * The list's cover image override from its front matter, when it declares a
   * usable one. An unreadable `image:` value is reported as one of
   * {@link LoadedCollection.warnings} instead.
   */
  image?: ListImageRef
  /** Custom art from the `.art.json` sidecar, keyed by card id. */
  art?: CardArtMap
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

  const { entries, sectionOrder, labels, warnings, advisories, frontMatter } =
    parseCollectionFile(content)
  const displayName = parseTitleFromContent(content) ?? name
  // The block is carried verbatim by the flat parser, so the cover is read off
  // its mapping here rather than being interpreted during the parse. A value
  // the grammar cannot read degrades to an advisory — the list still loads.
  const { image, advisory } = readListImage(frontMatter?.data ?? {})

  const baseName = name.endsWith('.md') ? name.slice(0, -3) : name
  const { changelog, fileMtime, art, artWarnings } = await loadListSidecars(
    collectionsDir,
    baseName,
    filePath,
    { knownCardIds: cardIdsOf(entries) },
  )

  return {
    displayName,
    entries,
    sectionOrder,
    labels,
    image,
    art,
    // The parser's own advisories ride the same channel as its warnings and the
    // sidecar's: an ignored `labels:` and an ignored `image:` are both things
    // the user must hear about, and reporting one but not the other would be an
    // inconsistency with no reason behind it.
    warnings: [
      ...warnings,
      ...advisories,
      ...(advisory ? [t('site.detail.listImageInvalid', { reason: advisory })] : []),
      ...artWarnings,
    ],
    changelog,
    fileMtime,
  }
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
  /** The featured entry's card id, for the custom art its cover may wear. */
  let featuredCardId: number | undefined
  /** Every entry's displayed printing, for the buylist bake (empty when not baking). */
  const buylistSources: BuylistBakeSource[] = []
  const customArtFor = customArtLookup(loaded.art, ctx)
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
            `  ⚠️  ${t('site.detail.noLanguageCard', {
              language,
              name: entry.name,
              printing: `${entry.set.toUpperCase()}:${entry.collectorNumber}`,
            })}`,
          )
        }
      }
    }

    const card = cardMap[cardKey] ?? null
    // A proxy is not a real card, and a copy wearing custom art is no longer the
    // printing a price would be for: either way it is worth nothing in every
    // currency, is not a card whose price is *missing*, and no buyer is offered
    // it. Judged by the sidecar *reference*, not by the display URL beside it:
    // a reference whose file the build could not deploy shows the card's real
    // art and must still price at nothing, exactly as `ritual price` reads it.
    const art = customArtFor(entry.cardId)
    const priceless = isPriceless(
      effectiveLabels(entry.labels, loaded.labels),
      art.hasCustomArt === true,
    )
    if (ctx.buylist && !priceless) {
      buylistSources.push({ card, finish: entry.finish, language: entry.language })
    }
    const finish = displayFinish(card, entry.finish)
    // The printing's own price, before pricelessness is applied. The list's
    // totals use the baked zero; the cover pick below ranks by this, so a proxy
    // or a custom-art copy can still be the list's face — the same way a deck's
    // commander takes the cover whatever it is worth.
    const printingPrice = card ? getCardPriceForFinish(card, finish, 'usd') : 0
    const price = priceless ? 0 : printingPrice
    const priceEur = card && !priceless ? getCardPriceForFinish(card, finish, 'eur') : 0
    const priceTix = card && !priceless ? getCardPriceForFinish(card, finish, 'tix') : 0
    totalPrice += price
    totalPriceEur += priceEur
    totalPriceTix += priceTix
    if (!priceless) {
      if (price === 0) missingPriceCount++
      if (priceEur === 0) missingPriceCountEur++
      if (priceTix === 0) missingPriceCountTix++
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
      finish,
      condition: entry.condition ?? 'NM',
      language: entry.language,
      labels: entry.labels,
      ...art,
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
    // Baked so a `.md` downloaded from the site re-emits `image:` rather than
    // dropping it — the front matter a browser can rebuild is only what is here.
    ...(loaded.image ? { listImage: loaded.image } : {}),
    cards: cardMap,
    printings: printingsMap,
    symbolMap: ctx.symbolMap,
    useScryfallImgUrls: ctx.useScryfallImgUrls,
    totalPrice,
    defaultCurrency: ctx.defaultCurrency,
    pricesDate: ctx.pricesDate,
    changelog: changelog.length > 0 ? changelog : undefined,
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
  reportListCoverIssue(cover, 'collection', displayName, ctx)
  const featuredImage = cover.url

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
