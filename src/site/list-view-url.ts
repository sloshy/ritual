/**
 * Serialize the public list-view toolbar and card-filter state to URL query
 * parameters and back, so a configured view (grouping, sorting, filters, layout)
 * can be shared by link. Only values that deviate from the page's defaults are
 * written, keeping shared URLs minimal. Parsing is lenient: unknown or malformed
 * parameters are ignored rather than erroring, since the query string is
 * user-tamperable.
 */
import {
  type CardFilters,
  type LabelFilterOption,
  type NumericComparator,
  COPIES_MATCH_MODES,
  createDefaultCardFilters,
  isColorFilterActive,
  parseBuylistParam,
  parseLabelsParam,
  parseNonNegativeInteger,
  parsePriceAmount,
  parseShareListParam,
} from './card-filters'
import { BUYERS, type BuyerId } from '../buylist'
import { USD_PRICE_SOURCES, type UsdPriceSource } from '../pricing/price-source'
import {
  COLOR_MATCH_MODES,
  FILTER_MATCH_MODES,
  LIST_SHARE_MATCHES,
  LIST_SHARE_MODES,
  SET_CODE_FILTER_MODES,
} from './filter-mode'
import {
  SORT_BYS,
  type CardSize,
  type GroupBy,
  type PriceGroupStrategy,
  type SortBy,
  type SortLayer,
  type ViewMode,
  WUBRG,
} from './card-sorting'

/** The per-page defaults that determine which group/sort values are omitted from the URL. */
export type ListViewDefaults = {
  groupBy: GroupBy
  sortBy: SortBy
}

/** The full serializable toolbar + filter state for a list view. */
export type ListViewState = {
  viewMode: ViewMode
  cardSize: CardSize
  groupBy: GroupBy
  sortLayers: readonly SortLayer[]
  reverseGroups: boolean
  priceGroupStrategy: PriceGroupStrategy
  /** Whether sell mode is on. Only written by pages that offer it. */
  sellMode: boolean
  /** Which buyer sell mode quotes against; only written while sell mode is on. */
  buyer: BuyerId
  /**
   * Which store USD prices are read from, when that is an *explicit* choice.
   * Absent means "nothing shareable" (the default view, or sell mode's
   * courtesy default, which `sell=1` reproduces by itself) and writes nothing.
   */
  priceSource?: UsdPriceSource
  filters: CardFilters
}

/** A partial state parsed from the URL; absent keys keep their page default. */
export type ListViewOverrides = {
  viewMode?: ViewMode
  cardSize?: CardSize
  groupBy?: GroupBy
  sortLayers?: SortLayer[]
  reverseGroups?: boolean
  priceGroupStrategy?: PriceGroupStrategy
  sellMode?: boolean
  buyer?: BuyerId
  priceSource?: UsdPriceSource
  filters?: Partial<CardFilters>
}

const VIEW_MODES: readonly ViewMode[] = ['binder', 'list', 'overlap', 'stack']
const CARD_SIZES: readonly CardSize[] = ['large', 'medium', 'small']
const GROUP_BYS: readonly GroupBy[] = [
  'type',
  'section',
  'cmc',
  'color-identity',
  'price',
  'buylist-price',
  'on-buylist',
  'printing',
  'source',
  'none',
]
const PRICE_STRATEGIES: readonly PriceGroupStrategy[] = ['archidekt', 'five', 'ten']
const NUMERIC_OPS: readonly NumericComparator[] = ['=', '<', '<=', '>', '>=']

/** Param keys, kept short and readable for shareable URLs. */
const KEYS = {
  view: 'view',
  size: 'size',
  group: 'group',
  sort: 'sort',
  reverseGroups: 'revSections',
  priceBracket: 'bracket',
  hideLands: 'noLands',
  hideUnpriced: 'noUnpriced',
  hideExtras: 'noExtras',
  name: 'name',
  colors: 'colors',
  colorMode: 'colorMode',
  setCodes: 'sets',
  setCodeMode: 'setMode',
  cardTypes: 'types',
  cardTypeMode: 'typeMode',
  oracleTags: 'otags',
  oracleTagMode: 'otagMode',
  artTags: 'atags',
  artTagMode: 'atagMode',
  manaValue: 'mv',
  manaValueOp: 'mvOp',
  price: 'price',
  priceOp: 'priceOp',
  copies: 'copies',
  copiesOp: 'copiesOp',
  copiesMode: 'copiesMode',
  labels: 'labels',
  onBuylist: 'buylist',
  buylistPrice: 'buyPrice',
  buylistPriceOp: 'buyPriceOp',
  sellMode: 'sell',
  buyer: 'buyer',
  priceSource: 'prices',
  sharedWith: 'shared',
  sharedWithMode: 'sharedMode',
  sharedWithMatch: 'sharedMatch',
  notSharedWith: 'notShared',
  notSharedWithMatch: 'notSharedMatch',
} as const

function setOrDelete(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null) params.delete(key)
  else params.set(key, value)
}

/**
 * Encode the ordered sort layers as a comma-separated list, each layer being its
 * `sortBy` value with a leading `-` when reversed — e.g. `name,-price` sorts by
 * name ascending, then price descending. The single default layer produces just
 * the default `sortBy` (which the caller then omits from the URL).
 */
function encodeSortLayers(layers: readonly SortLayer[]): string {
  return layers.map((l) => (l.reverse ? `-${l.sortBy}` : l.sortBy)).join(',')
}

/** Parse the `sort` param back into sort layers, dropping any unrecognized fields. */
function parseSortLayers(value: string | null): SortLayer[] | undefined {
  if (value === null) return undefined
  const layers: SortLayer[] = []
  const seen = new Set<SortBy>()
  for (const raw of value.split(',')) {
    const token = raw.trim()
    if (token.length === 0) continue
    const reverse = token.startsWith('-')
    const sortBy = oneOf(reverse ? token.slice(1) : token, SORT_BYS)
    if (!sortBy || seen.has(sortBy)) continue
    seen.add(sortBy)
    layers.push({ sortBy, reverse })
  }
  return layers.length > 0 ? layers : undefined
}

/**
 * Write the deviations of `state` from `defaults` onto `params`, deleting any keys
 * that have returned to their default. Mutates `params` in place so foreign keys
 * (e.g. the combined view's list selection) are preserved.
 */
export function writeListViewParams(
  params: URLSearchParams,
  state: ListViewState,
  defaults: ListViewDefaults,
): void {
  const d = createDefaultCardFilters()
  const f = state.filters

  setOrDelete(params, KEYS.view, state.viewMode === 'binder' ? null : state.viewMode)
  setOrDelete(params, KEYS.size, state.cardSize === 'large' ? null : state.cardSize)
  setOrDelete(params, KEYS.group, state.groupBy === defaults.groupBy ? null : state.groupBy)
  // The default is a single, non-reversed layer on `defaults.sortBy`, which encodes
  // to exactly that value — so an untouched sort stays out of the URL.
  const sort = encodeSortLayers(state.sortLayers)
  setOrDelete(params, KEYS.sort, sort === defaults.sortBy ? null : sort)
  setOrDelete(params, KEYS.reverseGroups, state.reverseGroups ? '1' : null)
  setOrDelete(
    params,
    KEYS.priceBracket,
    state.priceGroupStrategy === 'archidekt' ? null : state.priceGroupStrategy,
  )

  setOrDelete(params, KEYS.hideLands, f.hideLands ? '1' : null)
  setOrDelete(params, KEYS.hideUnpriced, f.hideUnpriced ? '1' : null)
  setOrDelete(params, KEYS.hideExtras, f.hideExtras ? '1' : null)

  const name = f.name.trim()
  setOrDelete(params, KEYS.name, name.length > 0 ? name : null)

  // Colorless rides along in the same param as a leading 'C' (e.g. "CWU"), keeping
  // the whole color selection in one short key.
  const hasColors = isColorFilterActive(f)
  setOrDelete(
    params,
    KEYS.colors,
    hasColors ? `${f.colorless ? 'C' : ''}${f.colors.join('')}` : null,
  )
  setOrDelete(params, KEYS.colorMode, hasColors && f.colorMode !== d.colorMode ? f.colorMode : null)

  const hasSets = f.setCodes.length > 0
  setOrDelete(params, KEYS.setCodes, hasSets ? f.setCodes.join(',') : null)
  setOrDelete(
    params,
    KEYS.setCodeMode,
    hasSets && f.setCodeMode !== d.setCodeMode ? f.setCodeMode : null,
  )

  const hasTypes = f.cardTypes.length > 0
  setOrDelete(params, KEYS.cardTypes, hasTypes ? f.cardTypes.join(',') : null)
  setOrDelete(
    params,
    KEYS.cardTypeMode,
    hasTypes && f.cardTypeMode !== d.cardTypeMode ? f.cardTypeMode : null,
  )

  const hasOracleTags = f.oracleTags.length > 0
  setOrDelete(params, KEYS.oracleTags, hasOracleTags ? f.oracleTags.join(',') : null)
  setOrDelete(
    params,
    KEYS.oracleTagMode,
    hasOracleTags && f.oracleTagMode !== d.oracleTagMode ? f.oracleTagMode : null,
  )

  const hasArtTags = f.artTags.length > 0
  setOrDelete(params, KEYS.artTags, hasArtTags ? f.artTags.join(',') : null)
  setOrDelete(
    params,
    KEYS.artTagMode,
    hasArtTags && f.artTagMode !== d.artTagMode ? f.artTagMode : null,
  )

  const hasMana = f.manaValue !== null
  setOrDelete(params, KEYS.manaValue, hasMana ? String(f.manaValue) : null)
  setOrDelete(
    params,
    KEYS.manaValueOp,
    hasMana && f.manaValueOp !== d.manaValueOp ? f.manaValueOp : null,
  )

  const hasPrice = f.price !== null
  setOrDelete(params, KEYS.price, hasPrice ? String(f.price) : null)
  setOrDelete(params, KEYS.priceOp, hasPrice && f.priceOp !== d.priceOp ? f.priceOp : null)

  // The buyer only means something while sell mode is on, so it rides with it —
  // a shared link never carries a buyer for a view that is not selling.
  setOrDelete(params, KEYS.sellMode, state.sellMode ? '1' : null)
  setOrDelete(params, KEYS.buyer, state.sellMode ? state.buyer : null)

  // Absence is the "nothing shareable" arm; the writer never invents a value.
  setOrDelete(params, KEYS.priceSource, state.priceSource ?? null)

  const hasCopies = f.copies !== null
  setOrDelete(params, KEYS.copies, hasCopies ? String(f.copies) : null)
  setOrDelete(params, KEYS.copiesOp, hasCopies && f.copiesOp !== d.copiesOp ? f.copiesOp : null)
  setOrDelete(
    params,
    KEYS.copiesMode,
    hasCopies && f.copiesMode !== d.copiesMode ? f.copiesMode : null,
  )

  // Re-normalized on write so URL-seeded state can't persist a non-canonical order.
  const labels = parseLabelsParam(f.labels.join(','))
  setOrDelete(params, KEYS.labels, labels ? labels.join(',') : null)

  // Gated on sell mode like `buyer`: the chips only exist there, so writing the
  // filter for a view that hides it would bake an unclearable filter into a link.
  const buylist = state.sellMode ? parseBuylistParam(f.onBuylist.join(',')) : undefined
  setOrDelete(params, KEYS.onBuylist, buylist ? buylist.join(',') : null)

  // Sell-mode-only, like the chips: its field is hidden outside sell mode, so a
  // link carrying it would narrow a list the recipient cannot widen again.
  const hasBuylistPrice = state.sellMode && f.buylistPrice !== null
  setOrDelete(params, KEYS.buylistPrice, hasBuylistPrice ? String(f.buylistPrice) : null)
  setOrDelete(
    params,
    KEYS.buylistPriceOp,
    hasBuylistPrice && f.buylistPriceOp !== d.buylistPriceOp ? f.buylistPriceOp : null,
  )

  // The share filters' mode/match sub-options only mean something while their
  // list selection is non-empty, so they ride with it (the sets/setMode pattern).
  // Tokens are `type:slug` refKeys — the ':' is fine inside a CSV value.
  const hasShared = f.sharedWith.length > 0
  setOrDelete(params, KEYS.sharedWith, hasShared ? f.sharedWith.join(',') : null)
  setOrDelete(
    params,
    KEYS.sharedWithMode,
    hasShared && f.sharedWithMode !== d.sharedWithMode ? f.sharedWithMode : null,
  )
  setOrDelete(
    params,
    KEYS.sharedWithMatch,
    hasShared && f.sharedWithMatch !== d.sharedWithMatch ? f.sharedWithMatch : null,
  )
  const hasNotShared = f.notSharedWith.length > 0
  setOrDelete(params, KEYS.notSharedWith, hasNotShared ? f.notSharedWith.join(',') : null)
  setOrDelete(
    params,
    KEYS.notSharedWithMatch,
    hasNotShared && f.notSharedWithMatch !== d.notSharedWithMatch ? f.notSharedWithMatch : null,
  )
}

/**
 * Append a labels filter to an existing hash href, using the canonical param key
 * and normalized option order so the URL matches what `writeListViewParams` would
 * later produce. An empty or illegal combination (see `parseLabelsParam`) yields
 * the href unchanged rather than a filter that silently applies to nothing.
 */
export function withLabelsParam(href: string, labels: readonly LabelFilterOption[]): string {
  const normalized = parseLabelsParam(labels.join(','))
  if (!normalized) return href
  return `${href}${href.includes('?') ? '&' : '?'}${KEYS.labels}=${normalized.join(',')}`
}

/** True if any list-view parameter is present (used to decide whether to apply overrides). */
export function hasListViewParams(params: URLSearchParams): boolean {
  return Object.values(KEYS).some((key) => params.has(key))
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

/** Parse a comma-separated list of lowercase tokens, dropping blanks. */
function parseCsv(value: string | null): string[] | undefined {
  if (value === null) return undefined
  const items = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  return items.length > 0 ? [...new Set(items)] : undefined
}

/** A parsed color selection: WUBRG colors in canonical order, plus the colorless flag. */
type ParsedColors = { colors: string[]; colorless: boolean }

/**
 * Parse the color selection (e.g. "WUB", or "CG" for green plus colorless),
 * keeping canonical WUBRG order. Returns undefined when nothing was selected, so
 * the caller leaves both fields at their defaults.
 */
function parseColors(value: string | null): ParsedColors | undefined {
  if (value === null) return undefined
  const chars = new Set(value.toUpperCase().split(''))
  const colors = WUBRG.filter((c) => chars.has(c))
  const colorless = chars.has('C')
  return colors.length > 0 || colorless ? { colors, colorless } : undefined
}

/** Shared by mana value and copies, which are both plain non-negative integers. */
function parseIntegerParam(value: string | null): number | undefined {
  return value === null ? undefined : parseNonNegativeInteger(value)
}

function parsePrice(value: string | null): number | undefined {
  return value === null ? undefined : parsePriceAmount(value)
}

/** Read every recognized list-view parameter from `params` into a partial state. */
export function parseListViewParams(params: URLSearchParams): ListViewOverrides {
  const get = (key: string): string | null => params.get(key)
  const overrides: ListViewOverrides = {}

  const viewMode = oneOf(get(KEYS.view), VIEW_MODES)
  if (viewMode) overrides.viewMode = viewMode
  const cardSize = oneOf(get(KEYS.size), CARD_SIZES)
  if (cardSize) overrides.cardSize = cardSize
  const groupBy = oneOf(get(KEYS.group), GROUP_BYS)
  if (groupBy) overrides.groupBy = groupBy
  const sortLayers = parseSortLayers(get(KEYS.sort))
  if (sortLayers) overrides.sortLayers = sortLayers
  if (get(KEYS.reverseGroups) === '1') overrides.reverseGroups = true
  const priceGroupStrategy = oneOf(get(KEYS.priceBracket), PRICE_STRATEGIES)
  if (priceGroupStrategy) overrides.priceGroupStrategy = priceGroupStrategy
  if (get(KEYS.sellMode) === '1') overrides.sellMode = true
  const buyer = oneOf(get(KEYS.buyer), BUYERS)
  if (buyer) overrides.buyer = buyer
  const priceSource = oneOf(get(KEYS.priceSource), USD_PRICE_SOURCES)
  if (priceSource) overrides.priceSource = priceSource

  const filters: Partial<CardFilters> = {}
  if (get(KEYS.hideLands) === '1') filters.hideLands = true
  if (get(KEYS.hideUnpriced) === '1') filters.hideUnpriced = true
  if (get(KEYS.hideExtras) === '1') filters.hideExtras = true

  const name = get(KEYS.name)
  if (name !== null && name.trim().length > 0) filters.name = name.trim()

  const colors = parseColors(get(KEYS.colors))
  if (colors) {
    if (colors.colors.length > 0) filters.colors = colors.colors
    if (colors.colorless) filters.colorless = true
  }
  const colorMode = oneOf(get(KEYS.colorMode), COLOR_MATCH_MODES)
  if (colorMode) filters.colorMode = colorMode

  const setCodes = parseCsv(get(KEYS.setCodes))
  if (setCodes) filters.setCodes = setCodes
  const setCodeMode = oneOf(get(KEYS.setCodeMode), SET_CODE_FILTER_MODES)
  if (setCodeMode) filters.setCodeMode = setCodeMode

  const cardTypes = parseCsv(get(KEYS.cardTypes))
  if (cardTypes) filters.cardTypes = cardTypes
  const cardTypeMode = oneOf(get(KEYS.cardTypeMode), FILTER_MATCH_MODES)
  if (cardTypeMode) filters.cardTypeMode = cardTypeMode

  const oracleTags = parseCsv(get(KEYS.oracleTags))
  if (oracleTags) filters.oracleTags = oracleTags
  const oracleTagMode = oneOf(get(KEYS.oracleTagMode), FILTER_MATCH_MODES)
  if (oracleTagMode) filters.oracleTagMode = oracleTagMode

  const artTags = parseCsv(get(KEYS.artTags))
  if (artTags) filters.artTags = artTags
  const artTagMode = oneOf(get(KEYS.artTagMode), FILTER_MATCH_MODES)
  if (artTagMode) filters.artTagMode = artTagMode

  const manaValue = parseIntegerParam(get(KEYS.manaValue))
  if (manaValue !== undefined) {
    filters.manaValue = manaValue
    const manaValueOp = oneOf(get(KEYS.manaValueOp), NUMERIC_OPS)
    if (manaValueOp) filters.manaValueOp = manaValueOp
  }

  const price = parsePrice(get(KEYS.price))
  if (price !== undefined) {
    filters.price = price
    const priceOp = oneOf(get(KEYS.priceOp), NUMERIC_OPS)
    if (priceOp) filters.priceOp = priceOp
  }

  const copies = parseIntegerParam(get(KEYS.copies))
  if (copies !== undefined) {
    filters.copies = copies
    const copiesOp = oneOf(get(KEYS.copiesOp), NUMERIC_OPS)
    if (copiesOp) filters.copiesOp = copiesOp
    const copiesMode = oneOf(get(KEYS.copiesMode), COPIES_MATCH_MODES)
    if (copiesMode) filters.copiesMode = copiesMode
  }

  const labels = parseLabelsParam(get(KEYS.labels))
  if (labels) filters.labels = labels

  const onBuylist = parseBuylistParam(get(KEYS.onBuylist))
  if (onBuylist) filters.onBuylist = onBuylist

  const buylistPrice = parsePrice(get(KEYS.buylistPrice))
  if (buylistPrice !== undefined) {
    filters.buylistPrice = buylistPrice
    const buylistPriceOp = oneOf(get(KEYS.buylistPriceOp), NUMERIC_OPS)
    if (buylistPriceOp) filters.buylistPriceOp = buylistPriceOp
  }

  // Exclusion is parsed first so a token present in both share params survives
  // only in `notSharedWith` — the store keeps the two selections disjoint (see
  // updateShareSelection), and exclusion winning matches the predicate, where
  // presence in any excluded list fails the card regardless of inclusion.
  const notSharedWith = parseShareListParam(get(KEYS.notSharedWith))
  if (notSharedWith) {
    filters.notSharedWith = notSharedWith
    const notSharedWithMatch = oneOf(get(KEYS.notSharedWithMatch), LIST_SHARE_MATCHES)
    if (notSharedWithMatch) filters.notSharedWithMatch = notSharedWithMatch
  }

  const sharedRaw = parseShareListParam(get(KEYS.sharedWith))
  const excluded = new Set(notSharedWith ?? [])
  const sharedWith = sharedRaw?.filter((key) => !excluded.has(key))
  if (sharedWith && sharedWith.length > 0) {
    filters.sharedWith = sharedWith
    const sharedWithMode = oneOf(get(KEYS.sharedWithMode), LIST_SHARE_MODES)
    if (sharedWithMode) filters.sharedWithMode = sharedWithMode
    const sharedWithMatch = oneOf(get(KEYS.sharedWithMatch), LIST_SHARE_MATCHES)
    if (sharedWithMatch) filters.sharedWithMatch = sharedWithMatch
  }

  if (Object.keys(filters).length > 0) overrides.filters = filters
  return overrides
}
