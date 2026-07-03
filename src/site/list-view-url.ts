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
  type ColorFilterMode,
  type NumericComparator,
  createDefaultCardFilters,
  parseManaValueAmount,
  parsePriceAmount,
} from './card-filters'
import type { CardTypeFilterMode, CardTypeMatchLogic } from './card-types'
import type { TagFilterMode, TagMatchLogic } from './card-tags'
import {
  type CardSize,
  type GroupBy,
  type PriceGroupStrategy,
  type SortBy,
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
  sortBy: SortBy
  reverse: boolean
  reverseGroups: boolean
  priceGroupStrategy: PriceGroupStrategy
  filters: CardFilters
}

/** A partial state parsed from the URL; absent keys keep their page default. */
export type ListViewOverrides = {
  viewMode?: ViewMode
  cardSize?: CardSize
  groupBy?: GroupBy
  sortBy?: SortBy
  reverse?: boolean
  reverseGroups?: boolean
  priceGroupStrategy?: PriceGroupStrategy
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
  'printing',
  'source',
  'none',
]
const SORT_BYS: readonly SortBy[] = [
  'name',
  'cmc',
  'price',
  'edhrec',
  'file-order',
  'set-code',
  'color-identity',
]
const PRICE_STRATEGIES: readonly PriceGroupStrategy[] = ['archidekt', 'five', 'ten']
const COLOR_MODES: readonly ColorFilterMode[] = ['exclusive', 'inclusive']
const NUMERIC_OPS: readonly NumericComparator[] = ['=', '<', '<=', '>', '>=']
const TYPE_LOGICS: readonly CardTypeMatchLogic[] = ['and', 'or']
const TYPE_MODES: readonly CardTypeFilterMode[] = ['include', 'exclude']
const TAG_LOGICS: readonly TagMatchLogic[] = ['and', 'or']
const TAG_MODES: readonly TagFilterMode[] = ['include', 'exclude']

/** Param keys, kept short and readable for shareable URLs. */
const KEYS = {
  view: 'view',
  size: 'size',
  group: 'group',
  sort: 'sort',
  reverse: 'rev',
  reverseGroups: 'revSections',
  priceBracket: 'bracket',
  hideLands: 'noLands',
  hideUnpriced: 'noUnpriced',
  hideExtras: 'noExtras',
  name: 'name',
  colors: 'colors',
  colorMode: 'colorMode',
  setCodes: 'sets',
  cardTypes: 'types',
  cardTypeLogic: 'typeLogic',
  cardTypeMode: 'typeMode',
  oracleTags: 'otags',
  oracleTagLogic: 'otagLogic',
  oracleTagMode: 'otagMode',
  artTags: 'atags',
  artTagLogic: 'atagLogic',
  artTagMode: 'atagMode',
  manaValue: 'mv',
  manaValueOp: 'mvOp',
  price: 'price',
  priceOp: 'priceOp',
} as const

function setOrDelete(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null) params.delete(key)
  else params.set(key, value)
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
  setOrDelete(params, KEYS.sort, state.sortBy === defaults.sortBy ? null : state.sortBy)
  setOrDelete(params, KEYS.reverse, state.reverse ? '1' : null)
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

  const hasColors = f.colors.length > 0
  setOrDelete(params, KEYS.colors, hasColors ? f.colors.join('') : null)
  setOrDelete(params, KEYS.colorMode, hasColors && f.colorMode !== d.colorMode ? f.colorMode : null)

  setOrDelete(params, KEYS.setCodes, f.setCodes.length > 0 ? f.setCodes.join(',') : null)

  const hasTypes = f.cardTypes.length > 0
  setOrDelete(params, KEYS.cardTypes, hasTypes ? f.cardTypes.join(',') : null)
  setOrDelete(
    params,
    KEYS.cardTypeLogic,
    hasTypes && f.cardTypeLogic !== d.cardTypeLogic ? f.cardTypeLogic : null,
  )
  setOrDelete(
    params,
    KEYS.cardTypeMode,
    hasTypes && f.cardTypeMode !== d.cardTypeMode ? f.cardTypeMode : null,
  )

  const hasOracleTags = f.oracleTags.length > 0
  setOrDelete(params, KEYS.oracleTags, hasOracleTags ? f.oracleTags.join(',') : null)
  setOrDelete(
    params,
    KEYS.oracleTagLogic,
    hasOracleTags && f.oracleTagLogic !== d.oracleTagLogic ? f.oracleTagLogic : null,
  )
  setOrDelete(
    params,
    KEYS.oracleTagMode,
    hasOracleTags && f.oracleTagMode !== d.oracleTagMode ? f.oracleTagMode : null,
  )

  const hasArtTags = f.artTags.length > 0
  setOrDelete(params, KEYS.artTags, hasArtTags ? f.artTags.join(',') : null)
  setOrDelete(
    params,
    KEYS.artTagLogic,
    hasArtTags && f.artTagLogic !== d.artTagLogic ? f.artTagLogic : null,
  )
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

/** Parse the color selection (e.g. "WUB"), keeping canonical WUBRG order. */
function parseColors(value: string | null): string[] | undefined {
  if (value === null) return undefined
  const chars = new Set(value.toUpperCase().split(''))
  const colors = WUBRG.filter((c) => chars.has(c))
  return colors.length > 0 ? colors : undefined
}

function parseManaValue(value: string | null): number | undefined {
  return value === null ? undefined : parseManaValueAmount(value)
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
  const sortBy = oneOf(get(KEYS.sort), SORT_BYS)
  if (sortBy) overrides.sortBy = sortBy
  if (get(KEYS.reverse) === '1') overrides.reverse = true
  if (get(KEYS.reverseGroups) === '1') overrides.reverseGroups = true
  const priceGroupStrategy = oneOf(get(KEYS.priceBracket), PRICE_STRATEGIES)
  if (priceGroupStrategy) overrides.priceGroupStrategy = priceGroupStrategy

  const filters: Partial<CardFilters> = {}
  if (get(KEYS.hideLands) === '1') filters.hideLands = true
  if (get(KEYS.hideUnpriced) === '1') filters.hideUnpriced = true
  if (get(KEYS.hideExtras) === '1') filters.hideExtras = true

  const name = get(KEYS.name)
  if (name !== null && name.trim().length > 0) filters.name = name.trim()

  const colors = parseColors(get(KEYS.colors))
  if (colors) filters.colors = colors
  const colorMode = oneOf(get(KEYS.colorMode), COLOR_MODES)
  if (colorMode) filters.colorMode = colorMode

  const setCodes = parseCsv(get(KEYS.setCodes))
  if (setCodes) filters.setCodes = setCodes

  const cardTypes = parseCsv(get(KEYS.cardTypes))
  if (cardTypes) filters.cardTypes = cardTypes
  const cardTypeLogic = oneOf(get(KEYS.cardTypeLogic), TYPE_LOGICS)
  if (cardTypeLogic) filters.cardTypeLogic = cardTypeLogic
  const cardTypeMode = oneOf(get(KEYS.cardTypeMode), TYPE_MODES)
  if (cardTypeMode) filters.cardTypeMode = cardTypeMode

  const oracleTags = parseCsv(get(KEYS.oracleTags))
  if (oracleTags) filters.oracleTags = oracleTags
  const oracleTagLogic = oneOf(get(KEYS.oracleTagLogic), TAG_LOGICS)
  if (oracleTagLogic) filters.oracleTagLogic = oracleTagLogic
  const oracleTagMode = oneOf(get(KEYS.oracleTagMode), TAG_MODES)
  if (oracleTagMode) filters.oracleTagMode = oracleTagMode

  const artTags = parseCsv(get(KEYS.artTags))
  if (artTags) filters.artTags = artTags
  const artTagLogic = oneOf(get(KEYS.artTagLogic), TAG_LOGICS)
  if (artTagLogic) filters.artTagLogic = artTagLogic
  const artTagMode = oneOf(get(KEYS.artTagMode), TAG_MODES)
  if (artTagMode) filters.artTagMode = artTagMode

  const manaValue = parseManaValue(get(KEYS.manaValue))
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

  if (Object.keys(filters).length > 0) overrides.filters = filters
  return overrides
}
