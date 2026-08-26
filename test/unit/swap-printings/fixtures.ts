import type { Finish } from '../../../src/card/finish-condition'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { displayLanguage } from '../../../src/card/card-language'
import { cardPrintingKey, printingKey } from '../../../src/card/printing-key'
import { listRefKey, type NamedListRef } from '../../../src/site/combined-list'
import type {
  PriceOf,
  SwapCandidate,
  SwapSourceEntry,
  SwapSourceList,
  SwapTarget,
} from '../../../src/editor/swap-printings'
import { makeScryfallCard } from '../../test-utils'

export const DECK: NamedListRef = { type: 'deck', slug: 'edited', name: 'Edited Deck' }
export const BINDER: NamedListRef = { type: 'collection', slug: 'binder', name: 'Binder' }
export const CUBE: NamedListRef = { type: 'deck', slug: 'cube', name: 'Cube' }
export const WANTS: NamedListRef = { type: 'wanted', slug: 'wants', name: 'Wants' }

/** A Lightning Bolt printing with a nonfoil and foil USD price (null = unpriced). */
export function bolt(
  set: string,
  collectorNumber: string,
  usd: number | null,
  usdFoil: number | null = null,
  extra: Partial<ScryfallCard> = {},
): ScryfallCard {
  return makeScryfallCard({
    id: `bolt-${set}-${collectorNumber}${extra.lang ? `-${extra.lang}` : ''}`,
    name: 'Lightning Bolt',
    set,
    collector_number: collectorNumber,
    finishes: usdFoil !== null ? ['nonfoil', 'foil'] : ['nonfoil'],
    prices: {
      usd: usd === null ? null : String(usd),
      usd_foil: usdFoil === null ? null : String(usdFoil),
    },
    ...extra,
  })
}

export const boltLea = bolt('lea', '161', 400, null)
export const boltM10 = bolt('m10', '146', 2, 30)
export const boltSta = bolt('sta', '42', 10, 25)
/** Foil-only printing with a mixed-case collector number: no nonfoil price. */
export const boltFoilOnly = makeScryfallCard({
  id: 'bolt-plst-1',
  name: 'Lightning Bolt',
  set: 'plst',
  collector_number: 'M10-146',
  finishes: ['foil'],
  prices: { usd: null, usd_foil: '7' },
})

/**
 * Prices from the fixture card's USD fields by finish; null for no card or no
 * value. Non-English copies price at double, so a dropped `language` argument
 * changes every total that should carry one.
 */
export const priceOf: PriceOf = (card, finish, language) => {
  if (!card) return null
  const raw = finish === 'foil' ? card.prices.usd_foil : card.prices.usd
  if (raw === null || raw === undefined) return null
  return Number(raw) * (displayLanguage(language) === 'en' ? 1 : 2)
}

export function makeTarget(overrides: Partial<SwapTarget> = {}): SwapTarget {
  return {
    cardName: 'Lightning Bolt',
    cardIds: [7],
    sharedLine: true,
    quantity: 1,
    set: 'm10',
    collectorNumber: '146',
    section: 'Main',
    card: boltM10,
    ...overrides,
  }
}

export function makeSource(
  ref: NamedListRef,
  entries: SwapSourceEntry[],
  printings: ScryfallCard[] = [boltLea, boltM10, boltSta, boltFoilOnly],
): SwapSourceList {
  return {
    ref,
    entries,
    cards: Object.fromEntries(printings.map((p) => [cardPrintingKey(p), p])),
    printings: { 'Lightning Bolt': printings },
  }
}

/**
 * A ready-made English NM printing candidate for auto/moves tests. Copies are
 * numbered from `firstId`; give each candidate its own base so an in-move's
 * `sourceCardIds` identify which candidate supplied it.
 */
export function makeCandidate(
  source: NamedListRef,
  card: ScryfallCard,
  available: number,
  price: number | null,
  finish: Finish = 'nonfoil',
  overrides: Partial<SwapCandidate> = {},
  firstId = 100,
): SwapCandidate {
  return {
    key: `${listRefKey(source)}|${cardPrintingKey(card)}|${finish}|${displayLanguage(overrides.language)}|${overrides.condition ?? 'NM'}`,
    kind: 'printing',
    source,
    card,
    set: card.set,
    collectorNumber: card.collector_number,
    finish,
    available,
    copies: Array.from({ length: available }, (_, i) => ({ cardId: firstId + i })),
    price,
    ...overrides,
  }
}

/** A printing candidate whose printing is not in the cache: no card, no price. */
export function uncachedCandidate(source: NamedListRef, available: number): SwapCandidate {
  return {
    key: `${listRefKey(source)}|${printingKey('zzz', '1')}|nonfoil|en|NM`,
    kind: 'printing',
    source,
    card: null,
    set: 'zzz',
    collectorNumber: '1',
    finish: 'nonfoil',
    available,
    copies: Array.from({ length: available }, (_, i) => ({ cardId: 300 + i })),
    price: null,
  }
}

export function printinglessCandidate(source: NamedListRef, available: number): SwapCandidate {
  return {
    key: `${listRefKey(source)}|printingless|lightning bolt`,
    kind: 'printingless',
    source,
    card: null,
    available,
    copies: Array.from({ length: available }, (_, i) => ({ cardId: 200 + i })),
    price: null,
  }
}
