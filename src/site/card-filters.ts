import type { CardData } from './card-sorting'
import { WUBRG } from './card-sorting'
import { matchesAllTerms } from '../term-match'
import { getFrontFaceName } from '../scryfall/card-utils'
import { extractCardTypeTags, matchesCardTypes } from './card-types'
import { matchesTags } from './card-tags'
import {
  CARD_LABEL_SELECTIONS,
  isCardLabelSelection,
  matchesCardLabelSelection,
  type CardLabelSelection,
} from '../card-labels'
import type { ColorMatchMode, FilterMatchMode, SetCodeFilterMode } from './filter-mode'

export type { ColorMatchMode, FilterMatchMode, SetCodeFilterMode }

/**
 * One selectable chip in the labels filter. The alias names the site's
 * chip-specific rule on top of the shared selection vocabulary: here `keep`
 * and `none` are singleton selections (see {@link toggleLabelFilterOption}),
 * unlike the export filter, where a selection combines freely.
 */
export type LabelFilterOption = CardLabelSelection

/** Every labels-filter option, in canonical UI and URL order. */
export const LABEL_FILTER_OPTIONS = CARD_LABEL_SELECTIONS

/** The chips that replace the whole selection when picked (and reject URL combos). */
const EXCLUSIVE_LABEL_OPTIONS = ['keep', 'none'] as const satisfies readonly LabelFilterOption[]

function isExclusiveLabelOption(option: LabelFilterOption): boolean {
  return (EXCLUSIVE_LABEL_OPTIONS as readonly LabelFilterOption[]).includes(option)
}

/**
 * One selectable chip in the buylist filter. Symmetric on purpose: "not on
 * buylist" answers "what will the buyer *not* take", which is as useful when
 * deciding what to sell as knowing what they will.
 */
export type BuylistFilterOption = 'on' | 'off'

/** Every buylist-filter option, in canonical UI and URL order. */
export const BUYLIST_FILTER_OPTIONS = [
  'on',
  'off',
] as const satisfies readonly BuylistFilterOption[]

function isBuylistFilterOption(value: string): value is BuylistFilterOption {
  return (BUYLIST_FILTER_OPTIONS as readonly string[]).includes(value)
}

/** A numeric comparison operator shared by the mana value, price, and copies filters. */
export type NumericComparator = '=' | '<' | '<=' | '>' | '>='

/** Comparison applied between a card's mana value and the filter value. */
export type ManaValueComparator = NumericComparator

/** Comparison applied between a card's price (in the active currency) and the filter value. */
export type PriceComparator = NumericComparator

/** Comparison applied between a card's total copy count and the filter value. */
export type CopiesComparator = NumericComparator

export interface CardFilters {
  hideLands: boolean
  hideUnpriced: boolean
  /**
   * Hide the extra sections (maybeboard, tokens). Only meaningful on deck pages,
   * which apply it at the section level — `filterCards` does not use it.
   */
  hideExtras: boolean
  /** Space-separated terms; every term must appear in the card name (case-insensitive). */
  name: string
  /** Selected WUBRG colors in canonical order. Empty = no color filtering. */
  colors: string[]
  /**
   * Whether colorless (an empty color identity) is selected alongside `colors`.
   * Kept as its own flag rather than a sixth `colors` entry because colorless is
   * the *absence* of colors, and `colors` is WUBRG-normalized on every write
   * (`toggleColorSelection`) — a 'C' token there would be silently dropped.
   */
  colorless: boolean
  /**
   * 'subset': the card could be played in a deck whose identity is the selected
   * colors (its identity is a subset of the selection).
   * 'include': the card uses at least one of the selected colors.
   * 'exclude': the card uses none of them.
   * 'exact': the card's identity is exactly the selected colors.
   */
  colorMode: ColorMatchMode
  /** Lowercase set codes. Empty = no set filtering. */
  setCodes: string[]
  /** 'include': keep cards from the selected sets. 'exclude': drop them. */
  setCodeMode: SetCodeFilterMode
  /** Lowercase card type tags (types and subtypes). Empty = no type filtering. */
  cardTypes: string[]
  /** 'include': any selected type. 'exclude': none of them. 'exact': every one. */
  cardTypeMode: FilterMatchMode
  /** Lowercase oracle (functional) tag slugs. Empty = no oracle tag filtering. */
  oracleTags: string[]
  /** 'include': any selected tag. 'exclude': none of them. 'exact': every one. */
  oracleTagMode: FilterMatchMode
  /** Lowercase art (illustration) tag slugs. Empty = no art tag filtering. */
  artTags: string[]
  /** 'include': any selected tag. 'exclude': none of them. 'exact': every one. */
  artTagMode: FilterMatchMode
  /** Mana value compared via `manaValueOp`. Null = no mana value filtering. */
  manaValue: number | null
  manaValueOp: ManaValueComparator
  /**
   * Price (in the active currency) compared via `priceOp`. Null = no price
   * filtering. The value is currency-specific, so it is cleared when the user
   * switches currency. Cards with no price data never match a price filter.
   */
  price: number | null
  priceOp: PriceComparator
  /**
   * The buyer's per-copy offer (always USD, never the display currency)
   * compared via `buylistPriceOp`. Null = no buylist-price filtering. Cards
   * with no active offer never match, exactly as unpriced cards never match a
   * price filter. Reachable only in sell mode, like {@link CardFilters.onBuylist}.
   */
  buylistPrice: number | null
  /** Plain {@link NumericComparator}: {@link PriceComparator}'s "active currency" does not apply. */
  buylistPriceOp: NumericComparator
  /**
   * Total quantity of cards sharing this card's name (case-insensitively, and
   * by front face for double-faced cards), summed across every entry in the
   * list, compared via `copiesOp`. Null = no copies filtering.
   */
  copies: number | null
  copiesOp: CopiesComparator
  /**
   * Selected label chips, matched with OR semantics against each card's
   * *effective* labels (`'none'` matches an empty set). Empty = no label
   * filtering. `keep` and `none` are singleton selections by construction —
   * `toggleLabelFilterOption` is the only writer, so an illegal combination
   * cannot arise from the UI, and the URL parser drops one whole.
   */
  labels: LabelFilterOption[]
  /**
   * Selected buylist chips, matched with OR semantics against whether the buyer
   * has a product for the card. Empty = no buylist filtering. Only reachable in
   * sell mode; `useListViewUrlSync` drops the URL param on pages that do not
   * support it, so a shared link cannot leave a list filtered by a control the
   * page never shows.
   */
  onBuylist: BuylistFilterOption[]
}

export function createDefaultCardFilters(): CardFilters {
  return {
    hideLands: false,
    hideUnpriced: false,
    hideExtras: false,
    name: '',
    colors: [],
    colorless: false,
    colorMode: 'subset',
    setCodes: [],
    setCodeMode: 'include',
    cardTypes: [],
    cardTypeMode: 'exact',
    oracleTags: [],
    oracleTagMode: 'exact',
    artTags: [],
    artTagMode: 'exact',
    manaValue: null,
    manaValueOp: '=',
    price: null,
    priceOp: '=',
    buylistPrice: null,
    buylistPriceOp: '=',
    copies: null,
    copiesOp: '=',
    labels: [],
    onBuylist: [],
  }
}

/**
 * A money threshold: `0` is the site's "no price data" sentinel, not a price of
 * zero, so a card carrying it fails every comparator — including `<=`, which
 * would otherwise sweep in every unpriced card. A null threshold is inactive.
 */
function matchesMoneyThreshold(
  actual: number,
  op: NumericComparator,
  threshold: number | null,
): boolean {
  if (threshold === null) return true
  if (actual <= 0) return false
  return compareNumeric(actual, op, threshold)
}

/** Every filter field that exists only in sell mode; cleared and stripped together. */
export const SELL_MODE_FILTER_KEYS = [
  'onBuylist',
  'buylistPrice',
  'buylistPriceOp',
] as const satisfies readonly (keyof CardFilters)[]

function isLand(card: CardData): boolean {
  return card.cmc === 0 && (card.type.includes('Land') || card.type.includes('Basic'))
}

function compareNumeric(actual: number, op: NumericComparator, value: number): boolean {
  switch (op) {
    case '=':
      return actual === value
    case '<':
      return actual < value
    case '<=':
      return actual <= value
    case '>':
      return actual > value
    case '>=':
      return actual >= value
  }
}

/**
 * Match a card's set code, given whether it is one of the selected codes. A card
 * belongs to exactly one set, so this is a plain keep-or-drop rather than a
 * `matchesSelection` call — but it stays an exhaustive switch so that widening
 * `SetCodeFilterMode` fails to compile rather than silently falling through to
 * "exclude".
 */
function matchesSetCode(inSelection: boolean, mode: SetCodeFilterMode): boolean {
  switch (mode) {
    case 'include':
      return inSelection
    case 'exclude':
      return !inSelection
  }
}

/**
 * Match a card's color identity against the selected colors. `include`/`exclude`
 * mean the same any-of / none-of as everywhere else, but a color identity is the
 * card's *complete* color set, so it also supports `subset` (the card fits inside
 * the selection — "playable in a deck of these colors") and `exact` (the identity
 * equals the selection — the "exactly Azorius" query).
 *
 * `colorless` selects cards with an empty identity. It contributes no color to
 * the selection, so under `subset` it only bites when nothing else is selected
 * ("playable in a colorless deck" — a colorless card already fits inside every
 * other selection). Under the remaining modes it acts as one more thing a card
 * can match, and `exclude` stays the exact negation of `include`.
 */
/**
 * Whether the color filter is doing anything. Colorless is a selection in its own
 * right, so it activates the filter even with no WUBRG colors picked — shared so
 * the predicate, the active-count badge, and the URL writer can't disagree.
 */
export function isColorFilterActive(filters: Pick<CardFilters, 'colors' | 'colorless'>): boolean {
  return filters.colors.length > 0 || filters.colorless
}

type ColorIdentityQuery = {
  /** The card's own color identity. */
  identity: string[]
  /** The WUBRG colors the user selected. */
  selected: string[]
  colorless: boolean
  mode: ColorMatchMode
}

function matchesColorIdentity(query: ColorIdentityQuery): boolean {
  const { identity, selected, colorless, mode } = query
  const isColorless = identity.length === 0
  switch (mode) {
    case 'subset':
      return identity.every((c) => selected.includes(c))
    case 'include':
      return identity.some((c) => selected.includes(c)) || (colorless && isColorless)
    case 'exclude':
      return !identity.some((c) => selected.includes(c)) && !(colorless && isColorless)
    case 'exact':
      return colorless && isColorless
        ? true
        : selected.length > 0 &&
            identity.length === selected.length &&
            identity.every((c) => selected.includes(c))
  }
}

/**
 * Normalize a card name for name-based grouping (the copies filter's match
 * key). Double-faced cards are stored as "Front // Back" (Scryfall's own
 * name), so a two-sided printing is reduced to its front face before
 * comparing — otherwise a double-faced "Steam Vents // Steam Vents" would
 * never group with a single-sided "Steam Vents" of the same card.
 */
function normalizeCardName(name: string): string {
  return getFrontFaceName(name).toLowerCase()
}

/** Sum each card's quantity into a lowercase-name -> total-copies map, for the copies filter. */
function countCopiesByName(cards: CardData[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const key = normalizeCardName(card.name)
    counts.set(key, (counts.get(key) ?? 0) + card.quantity)
  }
  return counts
}

/** Apply every active filter to `cards`, returning the cards that pass all of them. */
export function filterCards<T extends CardData>(cards: T[], filters: CardFilters): T[] {
  const nameQuery = filters.name.trim()
  const setCodes = new Set(filters.setCodes.map((code) => code.toLowerCase()))
  const copyCounts = filters.copies !== null ? countCopiesByName(cards) : null
  return cards.filter((card) => {
    if (filters.hideLands && isLand(card)) return false
    if (filters.hideUnpriced && card.price <= 0) return false
    if (nameQuery.length > 0 && !matchesAllTerms(card.name, nameQuery)) return false
    if (
      isColorFilterActive(filters) &&
      !matchesColorIdentity({
        identity: card.colorIdentity,
        selected: filters.colors,
        colorless: filters.colorless,
        mode: filters.colorMode,
      })
    ) {
      return false
    }
    if (
      setCodes.size > 0 &&
      !matchesSetCode(setCodes.has(card.setCode.toLowerCase()), filters.setCodeMode)
    ) {
      return false
    }
    if (!matchesCardTypes(card.type, filters.cardTypes, filters.cardTypeMode)) return false
    if (!matchesTags(card.oracleTags, filters.oracleTags, filters.oracleTagMode)) return false
    if (!matchesTags(card.artTags, filters.artTags, filters.artTagMode)) return false
    if (
      filters.manaValue !== null &&
      !compareNumeric(card.cmc, filters.manaValueOp, filters.manaValue)
    ) {
      return false
    }
    if (!matchesMoneyThreshold(card.price, filters.priceOp, filters.price)) return false
    if (filters.copies !== null && copyCounts !== null) {
      // copyCounts is built from this exact `cards` array with the same key, so
      // every card here is guaranteed to already be a key in the map.
      const total = copyCounts.get(normalizeCardName(card.name))!
      if (!compareNumeric(total, filters.copiesOp, filters.copies)) return false
    }
    if (filters.labels.length > 0 && !matchesCardLabelSelection(card.labels, filters.labels)) {
      return false
    }
    if (filters.onBuylist.length > 0 && !matchesBuylistSelection(card.onBuylist, filters.onBuylist))
      return false
    if (!matchesMoneyThreshold(card.buylistPrice, filters.buylistPriceOp, filters.buylistPrice)) {
      return false
    }
    return true
  })
}

/** Number of filters currently active; drives the toolbar button badge. */
export function countActiveFilters(filters: CardFilters): number {
  let count = 0
  if (filters.hideLands) count++
  if (filters.hideUnpriced) count++
  if (filters.hideExtras) count++
  if (filters.name.trim().length > 0) count++
  // Colors and colorless are one control in the UI, so they count once together.
  if (isColorFilterActive(filters)) count++
  if (filters.setCodes.length > 0) count++
  if (filters.cardTypes.length > 0) count++
  if (filters.oracleTags.length > 0) count++
  if (filters.artTags.length > 0) count++
  if (filters.manaValue !== null) count++
  if (filters.price !== null) count++
  if (filters.copies !== null) count++
  if (filters.labels.length > 0) count++
  if (filters.onBuylist.length > 0) count++
  if (filters.buylistPrice !== null) count++
  return count
}

/**
 * Number of active filters that actually narrow the result of `filterCards`.
 * `hideExtras` is a section-level toggle applied by deck pages themselves —
 * `filterCards` ignores it — so it must not make a filtered subtotal appear
 * that is identical to the unfiltered one.
 */
export function countNarrowingFilters(filters: CardFilters): number {
  return countActiveFilters(filters) - (filters.hideExtras ? 1 : 0)
}

/** Collect the unique lowercase set codes present in `cards`, sorted, for autocomplete. */
export function collectSetCodes(cards: CardData[]): string[] {
  const codes = new Set<string>()
  for (const card of cards) {
    if (card.setCode.length > 0) codes.add(card.setCode.toLowerCase())
  }
  return [...codes].sort()
}

/** Collect the unique lowercase card type tags present in `cards`, sorted, for autocomplete. */
export function collectCardTypes(cards: CardData[]): string[] {
  const types = new Set<string>()
  for (const card of cards) {
    for (const tag of extractCardTypeTags(card.type)) types.add(tag)
  }
  return [...types].sort()
}

/** Collect the unique slugs from one tag field across `cards`, sorted, for autocomplete. */
function collectTagField(cards: CardData[], field: 'oracleTags' | 'artTags'): string[] {
  const tags = new Set<string>()
  for (const card of cards) {
    for (const tag of card[field]) tags.add(tag)
  }
  return [...tags].sort()
}

/** Collect the unique oracle tag slugs present in `cards`, sorted, for autocomplete. */
export function collectOracleTags(cards: CardData[]): string[] {
  return collectTagField(cards, 'oracleTags')
}

/** Collect the unique art tag slugs present in `cards`, sorted, for autocomplete. */
export function collectArtTags(cards: CardData[]): string[] {
  return collectTagField(cards, 'artTags')
}

/** Whether an oracle or art tag filter is currently active. */
export function isTagFilterActive(filters: CardFilters): boolean {
  return filters.oracleTags.length > 0 || filters.artTags.length > 0
}

/**
 * Names of cards from `addedNames` that appear in `cards` with no tag data
 * (empty `oracleTags` and `artTags`), deduped in list order. Used to warn that a
 * tag filter can't match cards just added in the editor, which arrive without
 * Scryfall Tagger data.
 */
export function untaggedAddedCardNames(cards: CardData[], addedNames: readonly string[]): string[] {
  if (addedNames.length === 0) return []
  const added = new Set(addedNames)
  const seen = new Set<string>()
  const result: string[] = []
  for (const card of cards) {
    if (
      added.has(card.name) &&
      card.oracleTags.length === 0 &&
      card.artTags.length === 0 &&
      !seen.has(card.name)
    ) {
      seen.add(card.name)
      result.push(card.name)
    }
  }
  return result
}

/** Result of parsing a numeric filter input: a value (null = cleared) or an error message. */
export type NumericFilterParse = { ok: true; value: number | null } | { ok: false; error: string }

/**
 * Parse a non-negative integer token, or undefined if malformed. The single
 * source of truth for the mana value and copies formats (both plain
 * non-negative integers), shared by the filter inputs (below) and the lenient
 * URL-param parser.
 */
export function parseNonNegativeInteger(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  return parseInt(trimmed, 10)
}

/**
 * Parse a price token to a non-negative amount with up to two decimal places, or
 * undefined if malformed. The single source of truth for the price format, shared
 * by the filter input (below) and the lenient URL-param parser.
 */
export function parsePriceAmount(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined
  return parseFloat(trimmed)
}

/**
 * Build a numeric filter input parser: empty input clears the filter,
 * otherwise `parseAmount` is applied and a failure reports `error`. The
 * shared shape behind `parseManaValueFilter`/`parsePriceFilter`/`parseCopiesFilter`.
 */
function makeNumericFilterParser(
  parseAmount: (raw: string) => number | undefined,
  error: string,
): (raw: string) => NumericFilterParse {
  return (raw) => {
    if (raw.trim().length === 0) return { ok: true, value: null }
    const value = parseAmount(raw)
    if (value === undefined) return { ok: false, error }
    return { ok: true, value }
  }
}

/** Parse the mana value filter input: empty clears the filter, otherwise a non-negative integer. */
export const parseManaValueFilter = makeNumericFilterParser(
  parseNonNegativeInteger,
  'Mana value must be a non-negative integer',
)

/**
 * Parse the price filter input: empty clears the filter, otherwise a non-negative
 * amount with up to two decimal places (in the currently selected currency).
 */
export const parsePriceFilter = makeNumericFilterParser(
  parsePriceAmount,
  'Price must be a non-negative number',
)

/**
 * Parse the buylist filter input. Its own message rather than reusing the price
 * parser's: the panel shows two price fields in sell mode, so "Price must be…"
 * would not say which one was rejected.
 */
export const parseBuylistPriceFilter = makeNumericFilterParser(
  parsePriceAmount,
  'Buylist price must be a non-negative number',
)

/** Parse the copies filter input: empty clears the filter, otherwise a non-negative integer. */
export const parseCopiesFilter = makeNumericFilterParser(
  parseNonNegativeInteger,
  'Copies must be a non-negative integer',
)

/**
 * Whether a card matches a buylist-chip selection. Selecting both chips (or
 * neither) matches everything, so the filter is inactive in both cases.
 */
export function matchesBuylistSelection(
  onBuylist: boolean,
  selected: readonly BuylistFilterOption[],
): boolean {
  return selected.includes(onBuylist ? 'on' : 'off')
}

/** Toggle a buylist-filter chip. The two chips are independent (OR). */
export function toggleBuylistFilterOption(
  selected: readonly BuylistFilterOption[],
  option: BuylistFilterOption,
): BuylistFilterOption[] {
  if (selected.includes(option)) return selected.filter((o) => o !== option)
  return BUYLIST_FILTER_OPTIONS.filter((o) => o === option || selected.includes(o))
}

/**
 * Parse a `buylist=` URL value leniently: comma-separated tokens, unknown ones
 * dropped, deduped into canonical order. Returns undefined when nothing usable
 * remains, leaving the filter at its default.
 */
export function parseBuylistParam(value: string | null): BuylistFilterOption[] | undefined {
  if (value === null) return undefined
  const tokens = value
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(isBuylistFilterOption)
  const options = BUYLIST_FILTER_OPTIONS.filter((option) => tokens.includes(option))
  return options.length > 0 ? options : undefined
}

/** Toggle a color in a selection, keeping the result in canonical WUBRG order. */
export function toggleColorSelection(selected: string[], color: string): string[] {
  if (selected.includes(color)) return selected.filter((c) => c !== color)
  return WUBRG.filter((c) => c === color || selected.includes(c))
}

/**
 * Toggle a labels-filter chip, enforcing the selection rules so the store can
 * never hold an illegal combination: `sale` and `trade` combine (OR); `keep`
 * and `none` are each exclusive selections that replace whatever was picked.
 * The result is in canonical {@link LABEL_FILTER_OPTIONS} order.
 */
export function toggleLabelFilterOption(
  selected: readonly LabelFilterOption[],
  option: LabelFilterOption,
): LabelFilterOption[] {
  if (selected.includes(option)) return selected.filter((o) => o !== option)
  if (isExclusiveLabelOption(option)) return [option]
  const next: readonly LabelFilterOption[] = selected.filter((o) => !isExclusiveLabelOption(o))
  return LABEL_FILTER_OPTIONS.filter((o) => o === option || next.includes(o))
}

/**
 * Parse a `labels=` URL value leniently: lowercase comma-separated tokens,
 * unknown ones dropped, deduped into canonical order. A combination the chips
 * cannot produce (`keep` or `none` alongside anything else) invalidates the
 * whole param — `undefined` — matching the store invariant rather than
 * silently repairing a hand-edited URL.
 */
export function parseLabelsParam(value: string | null): LabelFilterOption[] | undefined {
  if (value === null) return undefined
  const tokens = value
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(isCardLabelSelection)
  const options = LABEL_FILTER_OPTIONS.filter((option) => tokens.includes(option))
  if (options.length === 0) return undefined
  if (options.some(isExclusiveLabelOption) && options.length > 1) return undefined
  return options
}
