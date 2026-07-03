import type { CardData } from './card-sorting'
import { WUBRG } from './card-sorting'
import { matchesAllTerms } from '../term-match'
import {
  extractCardTypeTags,
  matchesCardTypes,
  type CardTypeFilterMode,
  type CardTypeMatchLogic,
} from './card-types'
import { matchesTags, type TagFilterMode, type TagMatchLogic } from './card-tags'

/** How selected colors are matched against a card's color identity. */
export type ColorFilterMode = 'exclusive' | 'inclusive'

/** A numeric comparison operator shared by the mana value and price filters. */
export type NumericComparator = '=' | '<' | '<=' | '>' | '>='

/** Comparison applied between a card's mana value and the filter value. */
export type ManaValueComparator = NumericComparator

/** Comparison applied between a card's price (in the active currency) and the filter value. */
export type PriceComparator = NumericComparator

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
   * 'exclusive': the card's color identity is exactly the selected colors.
   * 'inclusive': the card could be played in a deck whose identity is the
   * selected colors (its identity is a subset of the selection).
   */
  colorMode: ColorFilterMode
  /** Lowercase set codes. Empty = no set filtering. */
  setCodes: string[]
  /** Lowercase card type tags (types and subtypes). Empty = no type filtering. */
  cardTypes: string[]
  /** 'and': a card must have every selected type. 'or': at least one. */
  cardTypeLogic: CardTypeMatchLogic
  /** 'include': keep matching cards. 'exclude': drop matching cards. */
  cardTypeMode: CardTypeFilterMode
  /** Lowercase oracle (functional) tag slugs. Empty = no oracle tag filtering. */
  oracleTags: string[]
  /** 'and': a card must have every selected oracle tag. 'or': at least one. */
  oracleTagLogic: TagMatchLogic
  /** 'include': keep matching cards. 'exclude': drop matching cards. */
  oracleTagMode: TagFilterMode
  /** Lowercase art (illustration) tag slugs. Empty = no art tag filtering. */
  artTags: string[]
  /** 'and': a card must have every selected art tag. 'or': at least one. */
  artTagLogic: TagMatchLogic
  /** 'include': keep matching cards. 'exclude': drop matching cards. */
  artTagMode: TagFilterMode
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
}

export function createDefaultCardFilters(): CardFilters {
  return {
    hideLands: false,
    hideUnpriced: false,
    hideExtras: false,
    name: '',
    colors: [],
    colorMode: 'exclusive',
    setCodes: [],
    cardTypes: [],
    cardTypeLogic: 'or',
    cardTypeMode: 'include',
    oracleTags: [],
    oracleTagLogic: 'or',
    oracleTagMode: 'include',
    artTags: [],
    artTagLogic: 'or',
    artTagMode: 'include',
    manaValue: null,
    manaValueOp: '=',
    price: null,
    priceOp: '=',
  }
}

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

function matchesColorIdentity(
  identity: string[],
  selected: string[],
  mode: ColorFilterMode,
): boolean {
  if (mode === 'exclusive') {
    return identity.length === selected.length && identity.every((c) => selected.includes(c))
  }
  return identity.every((c) => selected.includes(c))
}

/** Apply every active filter to `cards`, returning the cards that pass all of them. */
export function filterCards<T extends CardData>(cards: T[], filters: CardFilters): T[] {
  const nameQuery = filters.name.trim()
  const setCodes = new Set(filters.setCodes.map((code) => code.toLowerCase()))
  return cards.filter((card) => {
    if (filters.hideLands && isLand(card)) return false
    if (filters.hideUnpriced && card.price <= 0) return false
    if (nameQuery.length > 0 && !matchesAllTerms(card.name, nameQuery)) return false
    if (
      filters.colors.length > 0 &&
      !matchesColorIdentity(card.colorIdentity, filters.colors, filters.colorMode)
    ) {
      return false
    }
    if (setCodes.size > 0 && !setCodes.has(card.setCode.toLowerCase())) return false
    if (filters.cardTypes.length > 0) {
      const matches = matchesCardTypes(card.type, filters.cardTypes, filters.cardTypeLogic)
      const shouldExclude = filters.cardTypeMode === 'include' ? !matches : matches
      if (shouldExclude) return false
    }
    if (filters.oracleTags.length > 0) {
      const matches = matchesTags(card.oracleTags, filters.oracleTags, filters.oracleTagLogic)
      const shouldExclude = filters.oracleTagMode === 'include' ? !matches : matches
      if (shouldExclude) return false
    }
    if (filters.artTags.length > 0) {
      const matches = matchesTags(card.artTags, filters.artTags, filters.artTagLogic)
      const shouldExclude = filters.artTagMode === 'include' ? !matches : matches
      if (shouldExclude) return false
    }
    if (
      filters.manaValue !== null &&
      !compareNumeric(card.cmc, filters.manaValueOp, filters.manaValue)
    ) {
      return false
    }
    if (filters.price !== null) {
      // A card with no price data (price <= 0) can't satisfy a price comparison.
      if (card.price <= 0) return false
      if (!compareNumeric(card.price, filters.priceOp, filters.price)) return false
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
  if (filters.colors.length > 0) count++
  if (filters.setCodes.length > 0) count++
  if (filters.cardTypes.length > 0) count++
  if (filters.oracleTags.length > 0) count++
  if (filters.artTags.length > 0) count++
  if (filters.manaValue !== null) count++
  if (filters.price !== null) count++
  return count
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
 * Parse a mana value token to a non-negative integer, or undefined if malformed.
 * The single source of truth for the mana value format, shared by the filter
 * input (below) and the lenient URL-param parser.
 */
export function parseManaValueAmount(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  return parseInt(trimmed, 10)
}

/** Parse the mana value filter input: empty clears the filter, otherwise a non-negative integer. */
export function parseManaValueFilter(raw: string): NumericFilterParse {
  if (raw.trim().length === 0) return { ok: true, value: null }
  const value = parseManaValueAmount(raw)
  if (value === undefined) return { ok: false, error: 'Mana value must be a non-negative integer' }
  return { ok: true, value }
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
 * Parse the price filter input: empty clears the filter, otherwise a non-negative
 * amount with up to two decimal places (in the currently selected currency).
 */
export function parsePriceFilter(raw: string): NumericFilterParse {
  if (raw.trim().length === 0) return { ok: true, value: null }
  const value = parsePriceAmount(raw)
  if (value === undefined) return { ok: false, error: 'Price must be a non-negative number' }
  return { ok: true, value }
}

/** Toggle a color in a selection, keeping the result in canonical WUBRG order. */
export function toggleColorSelection(selected: string[], color: string): string[] {
  if (selected.includes(color)) return selected.filter((c) => c !== color)
  return WUBRG.filter((c) => c === color || selected.includes(c))
}
