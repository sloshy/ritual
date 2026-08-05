export type ViewMode = 'binder' | 'list' | 'overlap' | 'stack'
export type CardSize = 'large' | 'medium' | 'small'
export const CARD_SIZE_WIDTHS = {
  large: 190,
  medium: 140,
  small: 100,
} as const satisfies Record<CardSize, number>
export type GroupBy =
  | 'type'
  | 'section'
  | 'cmc'
  | 'color-identity'
  | 'price'
  | 'buylist-price'
  | 'on-buylist'
  | 'printing'
  | 'source'
  | 'none'
export type SortBy =
  | 'name'
  | 'cmc'
  | 'price'
  | 'buylist-price'
  | 'buylist-spread'
  | 'edhrec'
  | 'file-order'
  | 'set-code'
  | 'color-identity'
/**
 * One layer of an ordered, multi-level sort. Layers are applied in order: the
 * first is the primary sort, and each subsequent layer breaks ties within the
 * previous one. `reverse` flips just that layer's direction.
 */
export type SortLayer = { readonly sortBy: SortBy; readonly reverse: boolean }
export type PriceGroupStrategy = 'archidekt' | 'five' | 'ten'

/** A labeled option for a toolbar `<select>`, carrying its precise value type. */
export type SelectOption<T extends string = string> = { value: T; label: string }

/** Canonical display label for each sort field; the single source of truth for toolbar option labels. */
export const SORT_BY_LABELS = {
  name: 'Name',
  cmc: 'Mana Value',
  price: 'Price',
  'buylist-price': 'Buylist Price',
  'buylist-spread': 'Buylist vs Price',
  edhrec: 'EDHRec Rank',
  'file-order': 'File Order',
  'set-code': 'Set Code',
  'color-identity': 'Color Identity',
} as const satisfies Record<SortBy, string>

/**
 * Every sort field, derived from the labels rather than restated. `satisfies
 * Record<SortBy, string>` above makes the key set exactly `SortBy`, so a new
 * member is a compile error there instead of a shared link whose `sort=` value
 * silently fails to parse.
 */
export const SORT_BYS = Object.keys(SORT_BY_LABELS) as readonly SortBy[]

/**
 * The group-by options sell mode adds, in the order they appear after the
 * ordinary ones. Shared so every list page's dropdown — and the URL whitelist
 * that validates a shared link's `group=` — offer exactly the same set.
 */
export const SELL_GROUP_BY_OPTIONS = [
  { value: 'buylist-price', label: 'Buylist Price' },
  { value: 'on-buylist', label: 'On Buylist' },
] as const satisfies readonly SelectOption<GroupBy>[]

/** The sort fields sell mode adds. */
export const SELL_SORT_BYS = [
  'buylist-price',
  'buylist-spread',
] as const satisfies readonly SortBy[]

/**
 * A page's sort fields, with sell mode's appended when the page offers them.
 * One helper so a page's toolbar dropdown and its URL-sync whitelist can never
 * be given different answers — they were, and a collection page's sort dropdown
 * silently lacked an option its shared links accepted.
 */
export function sortByValuesFor(
  base: readonly SortBy[],
  sellMode: boolean | undefined,
): readonly SortBy[] {
  return sellMode ? [...base, ...SELL_SORT_BYS] : base
}

/**
 * Build the toolbar's sort dropdown options from an ordered list of sort fields,
 * labeling each from {@link SORT_BY_LABELS}. Pages pass the subset and order they
 * offer; `overrides` lets a page relabel a field in context (e.g. the combined
 * view calls `file-order` "List Order").
 */
export function sortByOptions(
  values: readonly SortBy[],
  overrides?: Partial<Record<SortBy, string>>,
): SelectOption<SortBy>[] {
  return values.map((value) => ({ value, label: overrides?.[value] ?? SORT_BY_LABELS[value] }))
}

export interface CardData {
  name: string
  quantity: number
  cmc: number
  edhrec: number
  price: number
  /**
   * The selected buyer's active per-copy offer (USD), or 0 when there is none:
   * the card is not on the buylist, the buyer has paused it, or sell mode is
   * off. 0 is the same "no price" sentinel `price` uses, so buylist prices flow
   * through the existing filter/group/sort machinery unchanged.
   */
  buylistPrice: number
  /**
   * The buyer's offer minus the card's USD retail price. Positive means they
   * pay at or above retail. Always computed in USD on both sides — the display
   * currency would make the subtraction meaningless.
   *
   * `null` when no spread can be computed: no active offer, or no USD retail
   * price to compare against (an etched printing Scryfall prices only in EUR,
   * say). Those two are different situations but neither yields a number, and
   * conflating them into one is better than inventing a numeric stand-in.
   *
   * Sorts last by default; like every other field, reversing the layer brings
   * them to the front. Compare with {@link compareBuylistSpread}.
   */
  buylistSpread: number | null
  /**
   * Whether the buyer's catalog has this printing at all — true even for a
   * paused offer, whose `buylistPrice` is 0. Drives the on-buylist filter and
   * grouping. Always false while sell mode is off.
   */
  onBuylist: boolean
  type: string
  section: string
  fileOrder: number
  setCode: string
  colorIdentity: string[]
  /** Whether this entry is pinned to a specific printing (has both set and collector number). */
  hasPrinting: boolean
  /**
   * Finish of the copy this tile represents. Undefined on entries that do not
   * state one (deck and wanted lines default to nonfoil wherever it matters).
   */
  finish?: Finish
  /** Oracle (functional) tag slugs, shared across printings. Empty when untagged. */
  oracleTags: string[]
  /** Art (illustration) tag slugs for this printing. Empty when untagged. */
  artTags: string[]
  /**
   * Effective card labels (the entry's override, else its list's default).
   * Always empty for deck and wanted cards — labels are a collection concept.
   */
  labels: CardLabel[]
  card: ScryfallCard | null
  /**
   * Display name of the list this card came from. Only set in the combined
   * multi-list view, where it drives the "Source List" grouping. Undefined on
   * single-list pages.
   */
  sourceName?: string
}

export interface CardGroup<T extends CardData = CardData> {
  key: string
  cards: T[]
}

import { BUYLIST_CURRENCY } from '../buylist'
import type { Finish, ScryfallCard } from '../types'
import type { CardLabel } from '../card-labels'
import type { PriceCurrency } from '../price-currency'
import { getCurrencySymbol, getCurrencySuffix } from '../price-currency'

export { BUYLIST_CURRENCY }

// WUBRG canonical order
export const WUBRG: readonly string[] = ['W', 'U', 'B', 'R', 'G']

const COLOR_COMBO_NAMES: Record<string, string> = {
  '': 'Colorless',
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  // Guilds (two-color)
  WU: 'Azorius (WU)',
  WB: 'Orzhov (WB)',
  WR: 'Boros (WR)',
  WG: 'Selesnya (WG)',
  UB: 'Dimir (UB)',
  UR: 'Izzet (UR)',
  UG: 'Simic (UG)',
  BR: 'Rakdos (BR)',
  BG: 'Golgari (BG)',
  RG: 'Gruul (RG)',
  // Shards and Wedges (three-color)
  WUB: 'Esper (WUB)',
  WUR: 'Jeskai (WUR)',
  WUG: 'Bant (WUG)',
  WBR: 'Mardu (WBR)',
  WBG: 'Abzan (WBG)',
  WRG: 'Naya (WRG)',
  UBR: 'Grixis (UBR)',
  UBG: 'Sultai (UBG)',
  URG: 'Temur (URG)',
  BRG: 'Jund (BRG)',
  // Four-color
  WUBR: 'WUBR (Four Color)',
  WUBG: 'WUBG (Four Color)',
  WURG: 'WURG (Four Color)',
  WBRG: 'WBRG (Four Color)',
  UBRG: 'UBRG (Four Color)',
  // Five-color
  WUBRG: 'WUBRG (Five Color)',
}

/** Normalize a color identity array to a canonical WUBRG-ordered key string */
export function colorIdentityKey(colors: string[]): string {
  return WUBRG.filter((c) => colors.includes(c)).join('')
}

/** Get the display name for a color identity */
export function colorIdentityName(colors: string[]): string {
  const key = colorIdentityKey(colors)
  return COLOR_COMBO_NAMES[key] ?? key
}

/**
 * Compute a numeric sort value for a color identity in WUBRG order.
 * Mono colors sort first (W=1..G=5), then pairs, triples, etc.
 * Within the same count, combos are ordered by their constituent colors in WUBRG order.
 */
export function colorIdentitySortValue(colors: string[]): number {
  const key = colorIdentityKey(colors)
  if (key === '') return 0 // Colorless first

  // Group by color count, then order within group
  const count = key.length
  let value = count * 100 // base offset per color count

  // Within the same count, compute positional value from WUBRG indices
  for (let i = 0; i < key.length; i++) {
    value += WUBRG.indexOf(key[i]!) * Math.pow(5, key.length - 1 - i)
  }
  return value
}

function formatBracketValue(value: number, currency: PriceCurrency): string {
  const sym = getCurrencySymbol(currency)
  const suf = getCurrencySuffix(currency)
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2)
  return `${sym}${formatted}${suf}`
}

function getArchidektBrackets(currency: PriceCurrency): Array<[number, number, string]> {
  return [
    [0, 0.5, `${formatBracketValue(0, currency)} – ${formatBracketValue(0.5, currency)}`],
    [0.5, 1, `${formatBracketValue(0.5, currency)} – ${formatBracketValue(1, currency)}`],
    [1, 5, `${formatBracketValue(1, currency)} – ${formatBracketValue(5, currency)}`],
    [5, 10, `${formatBracketValue(5, currency)} – ${formatBracketValue(10, currency)}`],
    [10, 20, `${formatBracketValue(10, currency)} – ${formatBracketValue(20, currency)}`],
    [20, 50, `${formatBracketValue(20, currency)} – ${formatBracketValue(50, currency)}`],
    [50, 100, `${formatBracketValue(50, currency)} – ${formatBracketValue(100, currency)}`],
    [100, Infinity, `${formatBracketValue(100, currency)}+`],
  ]
}

const NO_PRICE_DATA_KEY = 'No Price Data'

/** Get the price group key for a card given a grouping strategy */
export function getPriceGroupKey(
  price: number,
  strategy: PriceGroupStrategy,
  currency: PriceCurrency = 'usd',
): string {
  if (price <= 0) return NO_PRICE_DATA_KEY

  if (strategy === 'archidekt') {
    const brackets = getArchidektBrackets(currency)
    for (const [low, high, label] of brackets) {
      if (price >= low && price < high) return label
    }
    return `${formatBracketValue(100, currency)}+`
  }

  const increment = strategy === 'five' ? 5 : 10
  const lower = Math.floor(price / increment) * increment
  const upper = lower + increment
  return `${formatBracketValue(lower, currency)} – ${formatBracketValue(upper, currency)}`
}

/** Get a numeric sort value for a price group key so groups sort in ascending order */
export function priceGroupSortValue(
  key: string,
  strategy: PriceGroupStrategy,
  currency: PriceCurrency = 'usd',
): number {
  if (key === NO_PRICE_DATA_KEY) return Infinity

  if (strategy === 'archidekt') {
    const brackets = getArchidektBrackets(currency)
    const idx = brackets.findIndex(([, , label]) => label === key)
    return idx >= 0 ? idx : brackets.length
  }
  // Extract lower bound number from label
  const match = key.match(/(\d+)/)
  return match ? parseInt(match[1]!, 10) : 0
}

/** Compute the total price for a group of cards */
export function groupTotalPrice(cards: CardData[]): number {
  return cards.reduce((sum, c) => sum + c.price * c.quantity, 0)
}

/**
 * Order two buylist spreads best-first: the largest gap (the buyer paying at or
 * above retail) leads, and cards with no computable spread (`null`) trail.
 *
 * Best-first rather than numerically ascending because that is what the field is
 * for — the same reason `edhrec` puts rank 1 first. Reversing the layer flips
 * the whole thing, including where the `null`s land, exactly as reversing a
 * price sort moves unpriced cards from last to first.
 */
export function compareBuylistSpread(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a > b ? -1 : 1
}

/**
 * Compare two cards by a single field, with no tiebreaker. Ascending for every
 * field except `buylist-spread`, whose natural order is best-first — see
 * {@link compareBuylistSpread}. Returns 0 when the field is equal, so callers
 * can chain to the next sort layer.
 */
function compareByField(a: CardData, b: CardData, sortBy: SortBy): number {
  switch (sortBy) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'file-order':
      return a.fileOrder - b.fileOrder
    case 'set-code':
      return a.setCode.localeCompare(b.setCode)
    case 'color-identity':
      return colorIdentitySortValue(a.colorIdentity) - colorIdentitySortValue(b.colorIdentity)
    // Spelled out because the field name differs from the sort key; the default
    // branch below only works for keys that are themselves numeric CardData fields.
    case 'buylist-price':
      return a.buylistPrice - b.buylistPrice
    case 'buylist-spread':
      return compareBuylistSpread(a.buylistSpread, b.buylistSpread)
    default:
      return a[sortBy] - b[sortBy]
  }
}

/**
 * Compare two cards across an ordered list of sort layers. Each layer is applied
 * in turn — the first layer that yields a non-zero comparison decides the order,
 * so later layers act as tiebreakers within the previous ones. As a final,
 * always-ascending tiebreaker (and to keep the overall sort stable), cards that
 * compare equal on every layer fall back to their name. An empty layer list
 * therefore sorts purely by name.
 */
export function compareBySortLayers(
  a: CardData,
  b: CardData,
  layers: readonly SortLayer[],
): number {
  for (const layer of layers) {
    const result = compareByField(a, b, layer.sortBy)
    if (result !== 0) return layer.reverse ? -result : result
  }
  return a.name.localeCompare(b.name)
}

export function getCardTypeCategory(typeLine: string): string {
  // For double-faced / multi-faced cards, Scryfall's combined type line is
  // "Front // Back". Categorize by the front face only, so e.g. a Creature
  // front with a Land back groups under Creature.
  const frontType = typeLine.split(' // ')[0] ?? typeLine
  if (frontType.includes('Creature')) return 'Creature'
  if (frontType.includes('Planeswalker')) return 'Planeswalker'
  if (frontType.includes('Instant')) return 'Instant'
  if (frontType.includes('Sorcery')) return 'Sorcery'
  if (frontType.includes('Artifact')) return 'Artifact'
  if (frontType.includes('Enchantment')) return 'Enchantment'
  if (frontType.includes('Land')) return 'Land'
  return 'Other'
}

const TYPE_ORDER = [
  'Creature',
  'Planeswalker',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Other',
]

// Group keys for the 'printing' grouping. A card is "specific" when it is pinned
// to a single printing (has both set and collector number); otherwise it accepts
// any printing.
const PRINTING_SPECIFIC_KEY = 'Specific Printing'
const PRINTING_ANY_KEY = 'Any Printing'
const PRINTING_ORDER = [PRINTING_SPECIFIC_KEY, PRINTING_ANY_KEY]

// Group keys for the 'on-buylist' grouping. "On" means the buyer's catalog has
// the printing, whether or not they are currently buying it.
const BUYLIST_ON_KEY = 'On Buylist'
const BUYLIST_OFF_KEY = 'Not on Buylist'
const BUYLIST_ORDER = [BUYLIST_ON_KEY, BUYLIST_OFF_KEY]

export function groupAndSortCards<T extends CardData>(
  cards: T[],
  groupBy: GroupBy,
  sortLayers: readonly SortLayer[],
  sectionOrder: string[],
  priceGroupStrategy?: PriceGroupStrategy,
  currency: PriceCurrency = 'usd',
  reverseGroups: boolean = false,
): CardGroup<T>[] {
  const sortFn = (a: CardData, b: CardData) => compareBySortLayers(a, b, sortLayers)

  const groups: Record<string, T[]> = {}

  if (groupBy === 'none') {
    groups['All Cards'] = [...cards].sort(sortFn)
  } else if (groupBy === 'cmc') {
    for (const c of cards) {
      const key = c.cmc.toString()
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
  } else if (groupBy === 'type') {
    for (const c of cards) {
      const key = getCardTypeCategory(c.type)
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
  } else if (groupBy === 'section') {
    for (const c of cards) {
      if (!groups[c.section]) groups[c.section] = []
      groups[c.section]!.push(c)
    }
  } else if (groupBy === 'color-identity') {
    for (const c of cards) {
      const key = colorIdentityName(c.colorIdentity)
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
  } else if (groupBy === 'price') {
    const strategy = priceGroupStrategy ?? 'archidekt'
    for (const c of cards) {
      const key = getPriceGroupKey(c.price, strategy, currency)
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
  } else if (groupBy === 'buylist-price') {
    const strategy = priceGroupStrategy ?? 'archidekt'
    for (const c of cards) {
      const key = getPriceGroupKey(c.buylistPrice, strategy, BUYLIST_CURRENCY)
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
  } else if (groupBy === 'on-buylist') {
    for (const c of cards) {
      const key = c.onBuylist ? BUYLIST_ON_KEY : BUYLIST_OFF_KEY
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
  } else if (groupBy === 'printing') {
    for (const c of cards) {
      const key = c.hasPrinting ? PRINTING_SPECIFIC_KEY : PRINTING_ANY_KEY
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
  } else if (groupBy === 'source') {
    for (const c of cards) {
      const key = c.sourceName ?? 'Unknown'
      if (!groups[key]) groups[key] = []
      groups[key].push(c)
    }
  }

  const keys = Object.keys(groups)
  if (groupBy === 'cmc') {
    keys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  } else if (groupBy === 'type') {
    keys.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b))
  } else if (groupBy === 'section') {
    keys.sort((a, b) => sectionOrder.indexOf(a) - sectionOrder.indexOf(b))
  } else if (groupBy === 'color-identity') {
    const nameToValue = new Map<string, number>()
    for (const c of cards) {
      const name = colorIdentityName(c.colorIdentity)
      if (!nameToValue.has(name)) {
        nameToValue.set(name, colorIdentitySortValue(c.colorIdentity))
      }
    }
    keys.sort((a, b) => (nameToValue.get(a) ?? 0) - (nameToValue.get(b) ?? 0))
  } else if (groupBy === 'price') {
    const strategy = priceGroupStrategy ?? 'archidekt'
    keys.sort(
      (a, b) =>
        priceGroupSortValue(a, strategy, currency) - priceGroupSortValue(b, strategy, currency),
    )
  } else if (groupBy === 'buylist-price') {
    const strategy = priceGroupStrategy ?? 'archidekt'
    keys.sort(
      (a, b) =>
        priceGroupSortValue(a, strategy, BUYLIST_CURRENCY) -
        priceGroupSortValue(b, strategy, BUYLIST_CURRENCY),
    )
  } else if (groupBy === 'on-buylist') {
    keys.sort((a, b) => BUYLIST_ORDER.indexOf(a) - BUYLIST_ORDER.indexOf(b))
  } else if (groupBy === 'printing') {
    keys.sort((a, b) => PRINTING_ORDER.indexOf(a) - PRINTING_ORDER.indexOf(b))
  } else if (groupBy === 'source') {
    // Order source groups by the order their lists first appear in the card list,
    // which mirrors the order the lists were selected for the combined view.
    const firstIndex = new Map<string, number>()
    cards.forEach((c, i) => {
      const key = c.sourceName ?? 'Unknown'
      if (!firstIndex.has(key)) firstIndex.set(key, i)
    })
    keys.sort((a, b) => (firstIndex.get(a) ?? 0) - (firstIndex.get(b) ?? 0))
  }

  const orderedKeys = keys.filter((key) => groups[key] && groups[key].length > 0)
  if (reverseGroups) orderedKeys.reverse()

  return orderedKeys.map((key) => ({
    key,
    cards: groups[key]!.sort(sortFn),
  }))
}
