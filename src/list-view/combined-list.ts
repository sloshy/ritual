import { BUYERS } from '../buylist'
import { buylistFieldsFor } from './buylist-quotes'
import type { ScryfallCard } from '../scryfall/types'
import type { PriceCurrency } from '../pricing/price-currency'
import { sitePrice, sitePriceForFinish } from './price-view'
import { displayFinish } from '../card/finish-condition'
import { type ListType, isListType } from '../list/list-type'
import { hasSpecificPrinting, findPrinting } from '../card/card-printing'
import { effectiveLabels } from '../card/card-labels'
import { isPricelessCard, pricelessFacts } from './priceless'
import { overlayCard } from './session-cache'
import { resolveCardPreview } from '../card/image-sources'
import { resolveWantedCardEntry } from './resolve-card'
import { sourceCard, type SourceCardMaps } from './source-cards'
import type { CardData } from './card-sorting'
import type { SelectedCard } from './useCardSelection'
import { fetchJson } from './useFetchJson'
import { detailUrl, reportDataFetchError } from './api-base'
import { isAbortError } from '../util/errors'
import type {
  BakedBuylist,
  DeckDetail,
  CollectionDetail,
  WantedListDetail,
  CollectionCardEntry,
  WantedListCardEntry,
} from '../list/site-data'
import { lookupPrintingCard, printingKey } from '../card/printing-key'
import { collectionTradeMaxQty, collectionTradeQtyMap } from './trade-qty'
import { storedLanguage, type CardLanguage } from '../card/card-language'

/**
 * A reference to a single list by its type and slug. Encoded into the combined-view
 * URL. Distinct from {@link import('../changes/change-event').ListRef}, which is keyed by
 * display name rather than slug.
 */
export interface CombinedListRef {
  type: ListType
  slug: string
}

/** A {@link CombinedListRef} paired with its display name, resolved from the site index. */
export interface NamedListRef extends CombinedListRef {
  name: string
}

/** A list's stable identity key, `type:slug` — also the URL token in combined hashes. */
export type ListRefKey = `${ListType}:${string}`

/** The single spelling of a list ref's `type:slug` identity key. */
export function listRefKey(ref: CombinedListRef): ListRefKey {
  return `${ref.type}:${ref.slug}`
}

/**
 * Parse one `type:slug` token — the inverse of {@link listRefKey} — or
 * `undefined` when the type is unknown or the slug empty. Slugs may themselves
 * contain `:`; only the first separator splits.
 */
export function parseListRefKeyToken(token: string): CombinedListRef | undefined {
  const sep = token.indexOf(':')
  if (sep < 0) return undefined
  const type = token.slice(0, sep)
  const slug = token.slice(sep + 1)
  if (!isListType(type) || !slug) return undefined
  return { type, slug }
}

/**
 * Parse a CSV of `type:slug` refKey tokens: tokens are trimmed, malformed ones
 * dropped, and duplicates (by canonical key) collapsed to their first
 * occurrence, preserving order. The single implementation behind the combined
 * view's `lists=` param and the share filters' `shared=`/`notShared=` params.
 */
export function parseListRefKeyCsv(raw: string): CombinedListRef[] {
  const refs: CombinedListRef[] = []
  const seen = new Set<ListRefKey>()
  for (const token of raw.split(',')) {
    const ref = parseListRefKeyToken(token.trim())
    if (!ref) continue
    const key = listRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

/** The combined-view selection: either every list, or an explicit set of list refs. */
export interface CombinedSelection {
  all: boolean
  /**
   * When `all`, restrict to a single list type (e.g. "all decks"). Omitted means
   * every list of every type. Ignored when `all` is false.
   */
  allType?: ListType
  refs: CombinedListRef[]
}

export interface LoadedDeckDetail {
  ref: CombinedListRef
  name: string
  kind: 'deck'
  detail: DeckDetail
}
export interface LoadedCollectionDetail {
  ref: CombinedListRef
  name: string
  kind: 'collection'
  detail: CollectionDetail
}
export interface LoadedWantedDetail {
  ref: CombinedListRef
  name: string
  kind: 'wanted'
  detail: WantedListDetail
}

/** A loaded list detail, tagged by type so builders can branch on the payload shape. */
export type LoadedListDetail = LoadedDeckDetail | LoadedCollectionDetail | LoadedWantedDetail

/**
 * A card in the combined view. Extends {@link CardData} (so it flows through the
 * shared group/sort/filter pipeline) with the source-list identity, a pre-built
 * {@link SelectedCard} for multi-select/trade, and the printings list for the modal.
 */
export interface CombinedCardData extends CardData {
  sourceName: string
  sourceKind: ListType
  sourceSlug: string
  /** Global selection key (`<kind> <name> <localKey>`), matching the source list's own keys. */
  selectKey: string
  /** Pre-built selection payload whose `key` equals {@link selectKey}. */
  selectedTile: SelectedCard
  /** Printings for the card detail modal. */
  printings: ScryfallCard[]
}

// ----- URL encoding -----

/** Hash route to a single list's page, e.g. `#/deck/murica`. */
export function listHref(type: ListType, slug: string): string {
  return `#/${type}/${slug}`
}

/**
 * Hash route to the combined view of every list (`#/combined?all`) or every list
 * of one type when `allType` is given (`#/combined?all=deck`).
 */
export function combinedAllHref(allType?: ListType): string {
  return `#${encodeCombinedHash({ all: true, allType, refs: [] })}`
}

/**
 * Encode a combined selection into a hash fragment (without the leading `#`),
 * e.g. `/combined?all`, `/combined?all=deck` (every deck), or
 * `/combined?lists=deck:murica,collection:red-binder`.
 */
export function encodeCombinedHash(selection: CombinedSelection): string {
  if (selection.all)
    return selection.allType ? `/combined?all=${selection.allType}` : '/combined?all'
  const csv = selection.refs.map(listRefKey).join(',')
  return `/combined?lists=${csv}`
}

/**
 * Parse the query portion of a `#/combined?...` hash (the text after `?`) into a
 * selection. `all` (optionally `all=<type>` to restrict to one list type) views
 * every matching list. Unknown list types or empty slugs are dropped. Invalid
 * input yields an empty, non-`all` selection.
 */
export function parseCombinedQuery(query: string): CombinedSelection {
  const params = new URLSearchParams(query)
  if (params.has('all')) {
    const type = params.get('all')
    if (type && isListType(type)) return { all: true, allType: type, refs: [] }
    return { all: true, refs: [] }
  }
  return { all: false, refs: parseListRefKeyCsv(params.get('lists') ?? '') }
}

// ----- Detail loading -----

/** One list's loaded detail payload, tagged by type — {@link LoadedListDetail} minus the naming. */
export type ListDetailResult =
  | { kind: 'deck'; detail: DeckDetail }
  | { kind: 'collection'; detail: CollectionDetail }
  | { kind: 'wanted'; detail: WantedListDetail }

/**
 * Fetch one list's detail JSON, dispatching on the ref's type. Throws on a
 * failed fetch — callers own error handling, because they disagree about
 * reporting: {@link loadCombinedDetails} routes failures through
 * `reportDataFetchError` (a missing combined-view list is a data problem),
 * while the share-filter source must not (its refs come from user-editable
 * URLs, where a missing list is expected input — see `list-shares.ts`).
 */
export async function loadListDetail(
  ref: CombinedListRef,
  signal?: AbortSignal,
): Promise<ListDetailResult> {
  if (ref.type === 'deck') {
    const detail = await fetchJson<DeckDetail>(detailUrl(ref.type, ref.slug), signal)
    return { kind: 'deck', detail }
  }
  if (ref.type === 'collection') {
    const detail = await fetchJson<CollectionDetail>(detailUrl(ref.type, ref.slug), signal)
    return { kind: 'collection', detail }
  }
  const detail = await fetchJson<WantedListDetail>(detailUrl(ref.type, ref.slug), signal)
  return { kind: 'wanted', detail }
}

/**
 * Fetch every selected list's detail JSON in parallel, preserving selection order.
 * Lists that fail to load are dropped (logged and reported), so the view degrades
 * gracefully.
 */
export async function loadCombinedDetails(
  refs: NamedListRef[],
  signal: AbortSignal,
): Promise<LoadedListDetail[]> {
  const tasks = refs.map(async (ref): Promise<LoadedListDetail | null> => {
    try {
      const loaded = await loadListDetail(ref, signal)
      return { ref, name: ref.name, ...loaded }
    } catch (e) {
      if (isAbortError(e)) throw e
      console.error(`Combined view: failed to load ${ref.type}/${ref.slug}:`, e)
      reportDataFetchError(e)
      return null
    }
  })
  const results = await Promise.all(tasks)
  return results.filter((r): r is LoadedListDetail => r !== null)
}

// ----- Card building -----

/**
 * Global selection key for a tile: `<kind> <name> <localKey>`. Mirrors the prefix
 * that {@link useCardSelection} applies on single-list pages, so selecting the same
 * card in the combined view and on its own list refers to one tile, never two.
 */
function selectKeyFor(kind: ListType, listName: string, localKey: string | number): string {
  return `${kind} ${listName} ${localKey}`
}

/** An entry's language as a selection field: `undefined` for English (or a bare line). */
function entryLanguage(language: CardLanguage | undefined): CardLanguage | undefined {
  return storedLanguage(language)
}

function buildDeckCards(
  loaded: LoadedDeckDetail,
  currency: PriceCurrency,
  useScryfallImgUrls: boolean,
  baseOrder: number,
): CombinedCardData[] {
  const { detail, ref, name } = loaded
  const out: CombinedCardData[] = []
  let localOrder = 0
  // Hoisted: one maps object for the whole list, not one per card line.
  const cardMaps: SourceCardMaps = {
    cards: detail.cards,
    cardKingdom: detail.cardsCardKingdom,
    currency,
  }
  for (const section of detail.deck.sections) {
    for (const entry of section.cards) {
      const specific = hasSpecificPrinting(entry)
      const matched = specific
        ? findPrinting(
            detail.printings[entry.name],
            entry.set,
            entry.collectorNumber,
            entry.language,
          )
        : null
      // Unpinned rows follow the active USD source's own printing pick, the same
      // rule the deck page applies.
      const card = overlayCard(matched ?? sourceCard(cardMaps, entry.name))
      // Resolved here because the combined view has no per-list context
      // downstream.
      const labels = effectiveLabels(entry.labels, detail.labels)
      // Same shape as the collection branch below: the priceless rule is asked
      // first, and only then does the price come from the card — a deck row
      // has no baked figure to fall back on, so an unresolved card is 0. The
      // art fact, not the display URL, decides: a reference whose file the
      // build could not deploy shows the real printing and still prices at 0.
      const facts = pricelessFacts(entry, labels)
      const priceless = isPricelessCard(facts)
      const price = priceless ? 0 : card ? sitePrice(card, currency) : 0
      const localKey = localOrder++
      const key = selectKeyFor('deck', name, localKey)
      const preview = resolveCardPreview(card, useScryfallImgUrls, entry.customArt)
      const selectedTile: SelectedCard = {
        key,
        name: entry.name,
        set: specific ? entry.set?.toLowerCase() : undefined,
        collectorNumber: specific ? entry.collectorNumber : undefined,
        finish: entry.finish,
        condition: entry.condition,
        language: entryLanguage(entry.language),
        labels,
        customArt: entry.customArt,
        hasCustomArt: entry.hasCustomArt,
        quantity: entry.quantity,
        groupSize: entry.quantity,
        price,
        scryfallCard: card,
        image: preview.image || undefined,
        sideways: preview.sideways,
        printings: specific ? undefined : (detail.printings[entry.name] ?? []),
        sourceName: name,
        sourceSlug: ref.slug,
        sourceKind: 'deck',
        maxQty: entry.quantity,
        cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
      }
      out.push({
        name: entry.name,
        quantity: entry.quantity,
        cmc: card?.cmc ?? 0,
        edhrec: card?.edhrec_rank ?? 999999,
        price,
        type: card?.type_line ?? '',
        section: section.name,
        fileOrder: baseOrder + localKey,
        setCode: card?.set ?? '',
        colorIdentity: card?.color_identity ?? [],
        hasPrinting: specific,
        pinnedPrintingKey: specific ? printingKey(entry.set, entry.collectorNumber) : undefined,
        oracleTags: card?.oracleTags ?? [],
        artTags: card?.artTags ?? [],
        labels,
        customArt: entry.customArt,
        hasCustomArt: entry.hasCustomArt,
        finish: entry.finish,
        // From the ENTRY, not the resolved card: under the default `en` cache no
        // `@lang` object is baked, so the card object cannot say (see CardData).
        language: entryLanguage(entry.language),
        ...buylistFieldsFor(card, entry.finish, entry.language, facts),
        card,
        sourceName: name,
        sourceKind: 'deck',
        sourceSlug: ref.slug,
        selectKey: key,
        selectedTile,
        printings: detail.printings[entry.name] ?? [],
      })
    }
  }
  return out
}

function buildCollectionCards(
  loaded: LoadedCollectionDetail,
  currency: PriceCurrency,
  useScryfallImgUrls: boolean,
  baseOrder: number,
): CombinedCardData[] {
  const { detail, ref, name } = loaded
  // Tiles stay unmerged here (one per line, the combined view's rule), but the
  // trade cap is still the duplicate group's size — see `trade-qty.ts`.
  const qtyMap = collectionTradeQtyMap(detail.entries)
  return detail.entries.map((entry: CollectionCardEntry, index): CombinedCardData => {
    // Language-resolved: a `[ja]` entry displays its baked `@ja` object when
    // present, falling through to the printing's default object.
    const card = overlayCard(lookupPrintingCard(detail.cards, entry))
    // Resolved here because the combined view has no per-list context downstream.
    const labels = effectiveLabels(entry.labels, detail.labels)
    // A proxy is not a real card, and a copy wearing custom art is not the
    // printing a price would be for: neither carries a price, whichever currency
    // the view is in — checked before the baked figure is even consulted. Asked
    // with the *effective* labels, not the entry's own override: a collection
    // whose front matter marks every card `proxy` is priceless line by line.
    const facts = pricelessFacts(entry, labels)
    const price = isPricelessCard(facts)
      ? 0
      : card
        ? sitePriceForFinish(card, entry.finish, currency)
        : entry.price
    const key = selectKeyFor('collection', name, index)
    const preview = resolveCardPreview(card, useScryfallImgUrls, entry.customArt)
    const selectedTile: SelectedCard = {
      key,
      name: entry.name,
      set: entry.set.toLowerCase(),
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      language: entryLanguage(entry.language),
      labels,
      customArt: entry.customArt,
      hasCustomArt: entry.hasCustomArt,
      note: entry.note,
      quantity: 1,
      groupSize: 1,
      price,
      scryfallCard: card,
      image: preview.image || undefined,
      sideways: preview.sideways,
      sourceName: name,
      sourceSlug: ref.slug,
      sourceKind: 'collection',
      maxQty: collectionTradeMaxQty(entry, qtyMap),
      cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
    }
    return {
      name: entry.name,
      quantity: 1,
      cmc: card?.cmc ?? 0,
      edhrec: card?.edhrec_rank ?? 999999,
      price,
      type: card?.type_line ?? '',
      section: entry.section,
      fileOrder: baseOrder + index,
      setCode: entry.set.toLowerCase(),
      colorIdentity: card?.color_identity ?? [],
      hasPrinting: true,
      pinnedPrintingKey: printingKey(entry.set, entry.collectorNumber),
      oracleTags: card?.oracleTags ?? [],
      artTags: card?.artTags ?? [],
      labels,
      customArt: entry.customArt,
      hasCustomArt: entry.hasCustomArt,
      finish: entry.finish,
      language: entryLanguage(entry.language),
      ...buylistFieldsFor(card, entry.finish, entry.language, facts),
      card,
      sourceName: name,
      sourceKind: 'collection',
      sourceSlug: ref.slug,
      selectKey: key,
      selectedTile,
      printings: detail.printings[entry.name] ?? [],
    }
  })
}

function buildWantedCards(
  loaded: LoadedWantedDetail,
  currency: PriceCurrency,
  useScryfallImgUrls: boolean,
  baseOrder: number,
): CombinedCardData[] {
  const { detail, ref, name } = loaded
  return detail.entries.map((entry: WantedListCardEntry, index): CombinedCardData => {
    const specific = hasSpecificPrinting(entry)
    const card = resolveWantedCardEntry(entry, {
      cards: detail.cards,
      cardKingdom: detail.cardsCardKingdom,
      currency,
    })
    // A copy wearing custom art carries no price at all (wanted lines have no
    // labels, so that is the only way one can be priceless). Otherwise: an entry
    // with no finish token is read at the printing's default finish, not flatly
    // as nonfoil — a foil-only printing has no nonfoil price to quote.
    // Wanted lines carry no labels, so the entry's art facts are the whole rule.
    const facts = pricelessFacts(entry)
    const price = isPricelessCard(facts)
      ? 0
      : card
        ? sitePriceForFinish(card, displayFinish(card, entry.finish), currency)
        : entry.price
    const key = selectKeyFor('wanted', name, index)
    const preview = resolveCardPreview(card, useScryfallImgUrls, entry.customArt)
    const selectedTile: SelectedCard = {
      key,
      name: entry.name,
      set: specific ? entry.set.toLowerCase() : undefined,
      collectorNumber: specific ? entry.collectorNumber : undefined,
      finish: entry.finish,
      language: entryLanguage(entry.language),
      customArt: entry.customArt,
      hasCustomArt: entry.hasCustomArt,
      note: entry.note,
      quantity: 1,
      groupSize: 1,
      price,
      scryfallCard: card,
      image: preview.image || undefined,
      sideways: preview.sideways,
      printings: specific ? undefined : (detail.printings[entry.name] ?? []),
      sourceName: name,
      sourceSlug: ref.slug,
      sourceKind: 'wanted',
      maxQty: 1,
      cardIds: entry.cardId !== undefined ? [entry.cardId] : [],
    }
    return {
      name: entry.name,
      quantity: 1,
      cmc: card?.cmc ?? 0,
      edhrec: card?.edhrec_rank ?? 999999,
      price,
      type: card?.type_line ?? '',
      section: entry.section,
      fileOrder: baseOrder + index,
      setCode: entry.set?.toLowerCase() ?? '',
      colorIdentity: card?.color_identity ?? [],
      hasPrinting: specific,
      pinnedPrintingKey: specific ? printingKey(entry.set, entry.collectorNumber) : undefined,
      oracleTags: card?.oracleTags ?? [],
      artTags: card?.artTags ?? [],
      labels: [],
      customArt: entry.customArt,
      hasCustomArt: entry.hasCustomArt,
      finish: entry.finish,
      language: entryLanguage(entry.language),
      ...buylistFieldsFor(card, entry.finish, entry.language, facts),
      card,
      sourceName: name,
      sourceKind: 'wanted',
      sourceSlug: ref.slug,
      selectKey: key,
      selectedTile,
      printings: detail.printings[entry.name] ?? [],
    }
  })
}

/**
 * Flatten every loaded list into one combined card list, in selection order.
 * No cross-entry combining is applied — the lowest-common-denominator rule that
 * collections impose (each physical entry stands alone). Deck entries keep their
 * own per-line quantity. `fileOrder` is a global running ordinal so the "File
 * Order" sort lays lists out back-to-back in selection order.
 */
export function buildCombinedCards(
  loaded: LoadedListDetail[],
  currency: PriceCurrency,
  useScryfallImgUrls: boolean,
): CombinedCardData[] {
  const out: CombinedCardData[] = []
  for (const list of loaded) {
    const base = out.length
    if (list.kind === 'deck') out.push(...buildDeckCards(list, currency, useScryfallImgUrls, base))
    else if (list.kind === 'collection')
      out.push(...buildCollectionCards(list, currency, useScryfallImgUrls, base))
    else out.push(...buildWantedCards(list, currency, useScryfallImgUrls, base))
  }
  return out
}

/** Merge every loaded list's mana-symbol map into one lookup for the combined toolbar/cards. */
export function mergeSymbolMaps(loaded: LoadedListDetail[]): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const list of loaded) Object.assign(merged, list.detail.symbolMap)
  return merged
}

/** Merge every loaded list's `cards` map, for seeding the shared session cache. */
export function mergeCardMaps(loaded: LoadedListDetail[]): Record<string, ScryfallCard | null> {
  const merged: Record<string, ScryfallCard | null> = {}
  for (const list of loaded) {
    for (const [k, v] of Object.entries(list.detail.cards)) {
      if (v || !(k in merged)) merged[k] = v
    }
  }
  return merged
}

/**
 * Merge every loaded list's baked buylist quotes into one payload for the
 * combined view, or `undefined` when not one of them carries any.
 *
 * Per buyer, the quote maps union (keys are printings, so the lists agree
 * wherever they overlap) and the stamps come from the most recently downloaded
 * feed — a combined view built from details generated at different times should
 * report the freshest one it is actually showing, not an arbitrary list's.
 *
 * `undefined` rather than an empty payload is deliberate: it is what makes
 * "none of these lists was quoted" reach the user as an explanation instead of
 * a silently priceless sell mode.
 */
export function mergeBakedBuylists(loaded: LoadedListDetail[]): BakedBuylist | undefined {
  const merged: BakedBuylist = {}
  let found = false
  for (const list of loaded) {
    const baked = list.detail.buylist
    if (!baked) continue
    found = true
    // Over the buyer vocabulary rather than the payload's own keys, so the
    // merged values stay typed as quotes instead of `quotes | undefined`.
    for (const buyer of BUYERS) {
      const quotes = baked[buyer]
      if (!quotes) continue
      const existing = merged[buyer]
      if (!existing) {
        // Reuse the payload as-is where it is the only one: the seed store
        // compares quote objects by identity, so preserving them keeps a
        // re-render of this memo from looking like new data.
        merged[buyer] = quotes
        continue
      }
      merged[buyer] =
        quotes.feedRetrievedAt > existing.feedRetrievedAt
          ? { ...quotes, quotes: { ...existing.quotes, ...quotes.quotes } }
          : { ...existing, quotes: { ...quotes.quotes, ...existing.quotes } }
    }
  }
  return found ? merged : undefined
}

/** Merge every loaded list's `printings` map, for seeding the shared session cache. */
export function mergePrintingMaps(loaded: LoadedListDetail[]): Record<string, ScryfallCard[]> {
  const merged: Record<string, ScryfallCard[]> = {}
  for (const list of loaded) {
    for (const [k, v] of Object.entries(list.detail.printings)) {
      if (!merged[k] || merged[k].length < v.length) merged[k] = v
    }
  }
  return merged
}
