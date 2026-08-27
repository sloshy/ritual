/**
 * Phase 2 of a site build: make sure the card cache can serve every name the
 * lists mention, then resolve each name to the printings the site displays —
 * the Scryfall representative and cheapest per currency, and Card Kingdom's own
 * picks when a feed is loaded — downloading symbols and images along the way.
 */
import path from 'node:path'
import {
  attachTags,
  computeRepresentativePrints,
  downloadImage,
  fetchCardData,
  fetchRepresentativePrints,
  getCardPrintings,
  type RepresentativePrintsResult,
} from '../scryfall'
import type { ScryfallCard } from '../scryfall/types'
import { cardCache, ensureCacheForCards } from '../cache'
import { PRICE_MAX_AGE_MS } from '../cache/constants'
import { offerBulkPriceRefresh, offerTagDownload } from '../cache/freshness'
import { bulkAllowed, refreshStaleAllowed, type RefreshMode } from '../cache/refresh'
import { cardHasTags } from '../cache/status'
import { ensureCardKingdomFeed, loadEnsuredFeed, type LoadedCardKingdomFeed } from '../cardkingdom'
import { cardKingdomDisplayPrints, type CardKingdomDisplayPrints } from '../cardkingdom/retail'
import type { PrintingQuoteFn } from '../cardkingdom/quote'
import { getBannedPrintings, wantsCardKingdomFeed } from '../config/ritual-config'
import { t } from '../i18n/t'
import { VALID_CURRENCIES, type PriceCurrency } from '../pricing/price-currency'
import { getErrorMessage } from '../util/errors'
import { sortPrintingsByRelease } from './shared'
import type { EnsureSymbols } from './assets'
import type { SiteCardData } from './types'

/** Download a card's face images into the build's `images/` directory. */
export async function downloadCardImages(card: ScryfallCard, imgDir: string): Promise<void> {
  // A single-faced card's image, else the front and (when present) back face's.
  const faces = card.image_uris
    ? [card.image_uris]
    : (card.card_faces ?? []).map((f) => f.image_uris)
  const front = faces[0]?.normal
  const back = faces[1]?.normal
  if (front) await downloadImage(front, path.join(imgDir, `${card.id}.jpg`))
  if (back) await downloadImage(back, path.join(imgDir, `${card.id}_back.jpg`))
}

/** What {@link prepareCardCache} readies the cache for. */
export type CardCachePrepInput = {
  cardNames: Set<string>
  mode: RefreshMode
  /** `--verbose`: list every name the cache lacks. */
  verbose: boolean
}

/** The gates {@link prepareCardCache} runs, injectable so a test can drive them without a network. */
export type CardCachePrepDeps = {
  ensureCards?: (names: Set<string>, allowBulk: boolean) => Promise<boolean>
  offerPrices?: (names: readonly string[], cacheJustRefreshed: boolean) => Promise<void>
  /** The line printed when the bulk download fails; the build's wording by default. */
  downloadFailed?: (reason: string) => string
}

export type CardCachePrep = {
  uniqueCards: string[]
  /** The last bulk refresh (the price stamp the fetch pass starts from), or null when never refreshed. */
  priceTimestampSeed: number | null
}

/**
 * Ensure the card cache has been bulk-downloaded at least once per week, or
 * refreshed if many cards are missing (unless bulk downloads aren't permitted).
 * A failed download must not abort a build the existing cache can still serve.
 */
export async function prepareCardCache(
  input: CardCachePrepInput,
  deps: CardCachePrepDeps = {},
): Promise<CardCachePrep> {
  const ensureCards =
    deps.ensureCards ??
    (async (names, allowBulk) =>
      (await ensureCacheForCards(names, undefined, { allowBulk })).refreshed)
  const offerPrices =
    deps.offerPrices ??
    ((names, cacheJustRefreshed) => offerBulkPriceRefresh(names, input.mode, cacheJustRefreshed))
  const downloadFailed =
    deps.downloadFailed ?? ((reason) => t('cli.buildSite.cacheDownloadFailed', { reason }))

  // Purge expired blocklist entries before fetching
  await cardCache.purgeExpiredBlocklist()

  const uniqueCards = Array.from(input.cardNames)
  console.log(`\n${t('cli.buildSite.uniqueCards', { count: uniqueCards.length })}`)

  let cacheJustRefreshed = false
  try {
    cacheJustRefreshed = await ensureCards(input.cardNames, bulkAllowed(input.mode))
  } catch (e) {
    console.error(downloadFailed(getErrorMessage(e)))
  }

  if (input.verbose) {
    const missingCards: string[] = []
    for (const name of uniqueCards) {
      if (!(await cardCache.get(name))) missingCards.push(name)
    }
    if (missingCards.length > 0) {
      console.log(t('cli.buildSite.fetchListHeader', { count: missingCards.length }))
      for (const name of missingCards) {
        console.log(t('cli.buildSite.fetchListEntry', { name }))
      }
    } else {
      console.log(t('cli.buildSite.allCardsCached'))
    }
  }

  const priceTimestampSeed = await cardCache.getLastRefreshedAt()
  await offerPrices(uniqueCards, cacheJustRefreshed)
  return { uniqueCards, priceTimestampSeed }
}

/**
 * The buyer feed sell mode's baked quotes and the `cardkingdom` price source's
 * printing picks both read, under this run's --refresh policy. Never fatal: a
 * build that cannot get a buylist is a site without buy prices, not a failed
 * build. Loaded ahead of the card loop because the CK picks happen per name
 * as the cards are fetched.
 */
export async function loadBakedFeed(mode: RefreshMode): Promise<LoadedCardKingdomFeed | undefined> {
  if (!wantsCardKingdomFeed()) return undefined
  const feed = await ensureCardKingdomFeed(mode)
  if (typeof feed === 'string') {
    console.warn(t('cli.buildSite.buylistUnavailable', { reason: feed }))
    return undefined
  }
  const bakedFeed = await loadEnsuredFeed(feed)
  console.log(
    t('cli.buildSite.buylistReady', {
      counted: t('domain.count.items', { count: bakedFeed.file.feed.products.length }),
    }),
  )
  return bakedFeed
}

/** A {@link SiteCardData} with a map per built currency and nothing in it yet. */
export function emptySiteCardData(currencies: readonly PriceCurrency[]): SiteCardData {
  const cardData: SiteCardData = { cards: {}, printings: {}, cheapest: {}, missing: {} }
  for (const cur of currencies) {
    cardData.cheapest[cur] = {}
    cardData.missing[cur] = []
  }
  return cardData
}

/** What {@link pickDisplayPrintings} chooses from. */
export type DisplayPrintingsInput = {
  /** The name's printings, in the order the site should list them. */
  printings: ScryfallCard[]
  /** What a name-only line shows when nothing prices it: the cache's first entry, or null when unknown. */
  card: ScryfallCard | null
  currencies: PriceCurrency[]
  bannedPrintings: ReadonlySet<string>
  /** Per-currency picks fetched fresh from Scryfall; absent means computed from `printings`. */
  repPrints?: RepresentativePrintsResult
  /** Card Kingdom's quote lookup, present only when the site offers CK prices. */
  ckQuote?: PrintingQuoteFn | null
}

/** The printings one name displays — the per-name slice of {@link SiteCardData}. */
export type DisplayPrintings = {
  /** The USD representative when priced, else the base card. */
  card: ScryfallCard | null
  cheapest: Partial<Record<PriceCurrency, ScryfallCard | null>>
  /** The built currencies that price no printing of the name. */
  missing: PriceCurrency[]
  cardKingdom?: CardKingdomDisplayPrints
}

/**
 * The one rule for which printings a name-only line shows: shared by the
 * build and the live server, so a built page and a live-served one always
 * display the same printing for the same line.
 */
export function pickDisplayPrintings(input: DisplayPrintingsInput): DisplayPrintings {
  const { printings, currencies, bannedPrintings } = input
  // Sorted once and used by both picks: the Scryfall representative and
  // Card Kingdom's below must read the same recency order or they are not
  // comparable answers to the same question.
  const sorted = sortPrintingsByRelease(printings)
  const repPrints =
    input.repPrints ?? computeRepresentativePrints(sorted, sorted, currencies, bannedPrintings)
  const picks: DisplayPrintings = { card: input.card, cheapest: {}, missing: [] }
  for (const cur of currencies) {
    const rep = repPrints[cur]?.representative ?? null
    if (!rep) picks.missing.push(cur)
    else if (cur === 'usd') picks.card = rep
    picks.cheapest[cur] = repPrints[cur]?.cheapest ?? rep ?? input.card
  }
  // Card Kingdom picks its own printings, from its own catalog at its own
  // prices — the TCGplayer-priced representative above is regularly a
  // printing CK never stocked, which reads as an unpriced card the moment
  // the site's USD source is switched to CK.
  if (input.ckQuote) {
    picks.cardKingdom = cardKingdomDisplayPrints(input.ckQuote, sorted, printings, bannedPrintings)
  }
  return picks
}

/**
 * File one name's picks into the maps the detail builders read. The CK maps
 * appear only once CK has priced something: an empty pair would claim a CK
 * view the site cannot fill.
 */
export function recordDisplayPrintings(
  cardData: SiteCardData,
  name: string,
  printings: ScryfallCard[],
  picks: DisplayPrintings,
): void {
  cardData.cards[name] = picks.card
  cardData.printings[name] = printings
  for (const cur of picks.missing) cardData.missing[cur]?.push(name)
  for (const cur of VALID_CURRENCIES) {
    const pick = picks.cheapest[cur]
    const target = cardData.cheapest[cur]
    if (target && pick !== undefined) target[name] = pick
  }
  const ck = picks.cardKingdom
  if (ck?.representative || ck?.cheapest) {
    cardData.cardKingdom ??= { cards: {}, cheapest: {} }
    if (ck.representative) cardData.cardKingdom.cards[name] = ck.representative
    if (ck.cheapest) cardData.cardKingdom.cheapest[name] = ck.cheapest
  }
}

/** What {@link fetchBuildCards} resolves. */
export type CardFetchInput = {
  uniqueCards: string[]
  mode: RefreshMode
  availableCurrencies: PriceCurrency[]
  /** Card Kingdom's quote lookup, present only when the site offers CK prices. */
  ckQuote: PrintingQuoteFn | null
  /** `--cache-images`: download every displayed printing's images. */
  cacheImages: boolean
  imagesDir: string
  ensureSymbols: EnsureSymbols
  /** Where the newest price stamp starts from (the last bulk refresh). */
  priceTimestampSeed: number | null
}

/** The printings a build displays, and the newest price stamp seen (null when nothing priced). */
export type FetchedCards = {
  cardData: SiteCardData
  latestPriceTimestamp: number | null
}

function updateProgress(current: number, total: number): void {
  const width = 30
  const percentage = total === 0 ? 100 : Math.round((current / total) * 100)
  const filled = total === 0 ? width : Math.round((width * current) / total)
  const empty = width - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${total})`)
}

/** Resolve every name to its displayed printings, with a progress bar. */
export async function fetchBuildCards(input: CardFetchInput): Promise<FetchedCards> {
  const fetched: FetchedCards = {
    cardData: emptySiteCardData(input.availableCurrencies),
    latestPriceTimestamp: input.priceTimestampSeed,
  }
  const totalCards = input.uniqueCards.length
  let processed = 0
  updateProgress(0, totalCards)

  for (const name of input.uniqueCards) {
    if (!(await cardCache.isBlocked(name)) && !fetched.cardData.cards[name]) {
      await fetchCard(name, input, fetched)
    }
    processed++
    updateProgress(processed, totalCards)
  }
  process.stdout.write('\n\n')
  return fetched
}

/** Resolve one name into `fetched`: printings, per-currency picks, symbols and images. */
async function fetchCard(
  name: string,
  input: CardFetchInput,
  fetched: FetchedCards,
): Promise<void> {
  const { availableCurrencies, cacheImages, imagesDir, ensureSymbols } = input
  const card = await fetchCardData(name, { silent: true })
  const printings = await getCardPrintings(name)

  // Use cached prices if they are less than one day old; otherwise fetch fresh from Scryfall
  const priceTimestamp = await cardCache.getTimestamp(name)
  const pricesFresh = priceTimestamp != null && Date.now() - priceTimestamp < PRICE_MAX_AGE_MS
  if (
    priceTimestamp != null &&
    (fetched.latestPriceTimestamp == null || priceTimestamp > fetched.latestPriceTimestamp)
  ) {
    fetched.latestPriceTimestamp = priceTimestamp
  }
  // Use cached prices when they're fresh, or when --refresh never forbids
  // refetching merely-stale prices; otherwise fetch representative and
  // cheapest print per requested currency (all pages via the queue).
  const picks = pickDisplayPrintings({
    printings,
    card,
    currencies: availableCurrencies,
    bannedPrintings: getBannedPrintings(),
    ...(pricesFresh || !refreshStaleAllowed(input.mode)
      ? {}
      : { repPrints: await fetchRepresentativePrints(name, availableCurrencies) }),
    ckQuote: input.ckQuote,
  })
  for (const cur of picks.missing) {
    console.warn(t('cli.buildSite.noPricing', { name, currency: cur.toUpperCase() }))
  }
  recordDisplayPrintings(fetched.cardData, name, printings, picks)

  // Symbols and images for the displayed card, then for every other printing
  // a tile can show — each distinct card once.
  const seenIds = new Set<string>()
  for (const shipped of [
    picks.card,
    ...Object.values(picks.cheapest),
    picks.cardKingdom?.representative ?? null,
    picks.cardKingdom?.cheapest ?? null,
  ]) {
    if (!shipped || seenIds.has(shipped.id)) continue
    seenIds.add(shipped.id)
    await ensureSymbols(shipped.mana_cost)
    await ensureSymbols(shipped.oracle_text)
    if (cacheImages) await downloadCardImages(shipped, imagesDir)
  }
}

/** Every distinct card object a build holds, across all the maps. */
function collectBuildCards(cardData: SiteCardData): ScryfallCard[] {
  const cards = new Set<ScryfallCard>()
  for (const map of [
    cardData.cards,
    ...Object.values(cardData.cheapest),
    cardData.cardKingdom?.cards ?? {},
    cardData.cardKingdom?.cheapest ?? {},
  ]) {
    for (const card of Object.values(map)) if (card) cards.add(card)
  }
  for (const printings of Object.values(cardData.printings)) {
    for (const card of printings) cards.add(card)
  }
  return [...cards]
}

/**
 * The site's tag filters need oracle/art tags on the cards. If none are present
 * (e.g. a cache populated before tags existed), fetch them now rather than
 * shipping empty filters — gated by the same refresh mode as the bulk download.
 */
export async function attachBuildTags(cardData: SiteCardData, mode: RefreshMode): Promise<void> {
  const buildCards = collectBuildCards(cardData)
  if (buildCards.length > 0 && !buildCards.some(cardHasTags)) {
    // The bake into the cache happens inside; the returned index tags the
    // cards already loaded for this build, without a second download.
    const tagIndex = await offerTagDownload(mode)
    if (tagIndex) {
      for (const card of buildCards) attachTags(card, tagIndex)
    }
  }
}
