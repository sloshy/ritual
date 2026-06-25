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
  | 'printing'
  | 'source'
  | 'none'
export type SortBy =
  | 'name'
  | 'cmc'
  | 'price'
  | 'edhrec'
  | 'file-order'
  | 'set-code'
  | 'color-identity'
export type PriceGroupStrategy = 'archidekt' | 'five' | 'ten'

export interface CardData {
  name: string
  quantity: number
  cmc: number
  edhrec: number
  price: number
  type: string
  section: string
  fileOrder: number
  setCode: string
  colorIdentity: string[]
  /** Whether this entry is pinned to a specific printing (has both set and collector number). */
  hasPrinting: boolean
  /** Oracle (functional) tag slugs, shared across printings. Empty when untagged. */
  oracleTags: string[]
  /** Art (illustration) tag slugs for this printing. Empty when untagged. */
  artTags: string[]
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

import type { ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'
import { getCurrencySymbol, getCurrencySuffix } from '../price-currency'

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

export function sortCards(a: CardData, b: CardData, sortBy: SortBy, reverse: boolean): number {
  let result: number
  switch (sortBy) {
    case 'name':
      result = a.name.localeCompare(b.name)
      break
    case 'file-order':
      result = a.fileOrder - b.fileOrder
      break
    case 'set-code':
      result = a.setCode.localeCompare(b.setCode) || a.name.localeCompare(b.name)
      break
    case 'color-identity':
      result =
        colorIdentitySortValue(a.colorIdentity) - colorIdentitySortValue(b.colorIdentity) ||
        a.name.localeCompare(b.name)
      break
    default: {
      const key = sortBy
      result = a[key] - b[key]
      break
    }
  }
  return reverse ? -result : result
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

export function groupAndSortCards<T extends CardData>(
  cards: T[],
  groupBy: GroupBy,
  sortBy: SortBy,
  reverse: boolean,
  sectionOrder: string[],
  priceGroupStrategy?: PriceGroupStrategy,
  currency: PriceCurrency = 'usd',
  reverseGroups: boolean = false,
): CardGroup<T>[] {
  const sortFn = (a: CardData, b: CardData) => sortCards(a, b, sortBy, reverse)

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
