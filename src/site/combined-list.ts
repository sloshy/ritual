import type { ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'
import { getCardPrice, getCardPriceForFinish } from '../price-currency'
import { defaultPrintingFinish } from '../finish-condition'
import { type ListType, isListType } from '../list-type'
import { hasSpecificPrinting, findPrinting } from '../card-printing'
import { overlayCard } from './session-cache'
import { resolveCardPreview } from './image-sources'
import { resolveWantedCardEntry } from './resolve-card'
import type { CardData } from './card-sorting'
import type { SelectedCard } from './useCardSelection'
import { fetchJson } from './useFetchJson'
import { detailUrl, reportDataFetchError } from './api-base'
import { isAbortError } from './utils'
import type {
  DeckDetail,
  CollectionDetail,
  WantedListDetail,
  CollectionCardEntry,
  WantedListCardEntry,
} from './data-types'

/**
 * A reference to a single list by its type and slug. Encoded into the combined-view
 * URL. Distinct from {@link import('../change-event').ListRef}, which is keyed by
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
  const csv = selection.refs.map((r) => `${r.type}:${r.slug}`).join(',')
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
  const raw = params.get('lists') ?? ''
  const refs: CombinedListRef[] = []
  const seen = new Set<string>()
  for (const token of raw.split(',')) {
    const sep = token.indexOf(':')
    if (sep < 0) continue
    const type = token.slice(0, sep)
    const slug = token.slice(sep + 1)
    if (!isListType(type) || !slug) continue
    const key = `${type}:${slug}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ type, slug })
  }
  return { all: false, refs }
}

// ----- Detail loading -----

/**
 * Fetch every selected list's detail JSON in parallel, preserving selection order.
 * Lists that fail to load are dropped (logged), so the view degrades gracefully.
 */
export async function loadCombinedDetails(
  refs: NamedListRef[],
  signal: AbortSignal,
): Promise<LoadedListDetail[]> {
  const tasks = refs.map(async (ref): Promise<LoadedListDetail | null> => {
    try {
      if (ref.type === 'deck') {
        const detail = await fetchJson<DeckDetail>(detailUrl(ref.type, ref.slug), signal)
        return { ref, name: ref.name, kind: 'deck', detail }
      }
      if (ref.type === 'collection') {
        const detail = await fetchJson<CollectionDetail>(detailUrl(ref.type, ref.slug), signal)
        return { ref, name: ref.name, kind: 'collection', detail }
      }
      const detail = await fetchJson<WantedListDetail>(detailUrl(ref.type, ref.slug), signal)
      return { ref, name: ref.name, kind: 'wanted', detail }
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

function buildDeckCards(
  loaded: LoadedDeckDetail,
  currency: PriceCurrency,
  useScryfallImgUrls: boolean,
  baseOrder: number,
): CombinedCardData[] {
  const { detail, ref, name } = loaded
  const out: CombinedCardData[] = []
  let localOrder = 0
  for (const section of detail.deck.sections) {
    for (const entry of section.cards) {
      const specific = hasSpecificPrinting(entry)
      const matched = specific
        ? findPrinting(detail.printings[entry.name], entry.set, entry.collectorNumber)
        : null
      const card = overlayCard(matched ?? detail.cards[entry.name] ?? null)
      const price = card ? getCardPrice(card, currency) : 0
      const localKey = localOrder++
      const key = selectKeyFor('deck', name, localKey)
      const preview = resolveCardPreview(card, useScryfallImgUrls)
      const selectedTile: SelectedCard = {
        key,
        name: entry.name,
        set: specific ? entry.set?.toLowerCase() : undefined,
        collectorNumber: specific ? entry.collectorNumber : undefined,
        finish: entry.finish,
        condition: entry.condition,
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
        oracleTags: card?.oracleTags ?? [],
        artTags: card?.artTags ?? [],
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
  return detail.entries.map((entry: CollectionCardEntry, index): CombinedCardData => {
    const cardKey = `${entry.set.toLowerCase()}:${entry.collectorNumber}`
    const card = overlayCard(detail.cards[cardKey] ?? null)
    const price = card ? getCardPriceForFinish(card, entry.finish, currency) : entry.price
    const key = selectKeyFor('collection', name, index)
    const preview = resolveCardPreview(card, useScryfallImgUrls)
    const selectedTile: SelectedCard = {
      key,
      name: entry.name,
      set: entry.set.toLowerCase(),
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
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
      setCode: entry.set.toLowerCase(),
      colorIdentity: card?.color_identity ?? [],
      hasPrinting: true,
      oracleTags: card?.oracleTags ?? [],
      artTags: card?.artTags ?? [],
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
    const card = resolveWantedCardEntry(entry, detail.cards)
    // An entry with no finish token is read at the printing's default finish, not
    // flatly as nonfoil: a foil-only printing has no nonfoil price to quote.
    const price = card
      ? getCardPriceForFinish(card, entry.finish ?? defaultPrintingFinish(card), currency)
      : entry.price
    const key = selectKeyFor('wanted', name, index)
    const preview = resolveCardPreview(card, useScryfallImgUrls)
    const selectedTile: SelectedCard = {
      key,
      name: entry.name,
      set: specific ? entry.set.toLowerCase() : undefined,
      collectorNumber: specific ? entry.collectorNumber : undefined,
      finish: entry.finish,
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
      oracleTags: card?.oracleTags ?? [],
      artTags: card?.artTags ?? [],
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
