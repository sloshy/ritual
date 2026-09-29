import { afterEach, describe, expect, test } from 'bun:test'
import { resetBuylistQuotes, seedBuylistQuotes } from '../../../src/list-view/buylist-quotes'
import {
  activeCurrency,
  activeStore,
  activeUsdSource,
  offeredPriceSources,
  offersUsdSourceChoice,
  pricesEnabled,
  resetPriceView,
  seedPriceView,
  selectStore,
  sitePrice,
  sitePriceForFinish,
  usdSourceChoices,
  storeIsExplicit,
} from '../../../src/list-view/price-view'
import type { PriceSource } from '../../../src/pricing/price-source'
import { resetSellMode, setSellModeActive } from '../../../src/list-view/sell-mode'
import { makeBuylistQuote, makeScryfallCard } from '../../test-utils'

afterEach(() => {
  resetPriceView()
  resetSellMode()
  resetBuylistQuotes()
})

const card = makeScryfallCard({
  set: 'tst',
  collector_number: '7',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '2.00', usd_foil: '5.00', eur: '1.50' },
})

function seedRetail(key: string, priceRetail: number): void {
  seedBuylistQuotes({
    cardkingdom: {
      quotes: { [key]: makeBuylistQuote({ priceRetail, qtyRetail: 1 }) },
      feedCreatedAt: '2026-08-04 06:06:09',
      feedRetrievedAt: 1,
    },
  })
}

/** Seed a deployment the way both SPAs do. */
function seed(stores: PriceSource[], defaultSource: PriceSource = stores[0] ?? 'tcgplayer'): void {
  seedPriceView({ stores, defaultSource })
}

describe('offered stores', () => {
  test('an empty store list disables prices entirely', () => {
    seed([], 'tcgplayer')
    expect(pricesEnabled()).toBe(false)
    expect(offeredPriceSources()).toEqual([])
  })

  test('offers every store in picker order, the USD stores together', () => {
    seed(['cardmarket', 'tcgplayer', 'cardkingdom'])
    expect(offeredPriceSources()).toEqual(['tcgplayer', 'cardkingdom', 'cardmarket'])
  })

  test('a dialog offers a USD-store choice only in USD with both USD stores enabled', () => {
    seed(['tcgplayer', 'cardkingdom'])
    expect(offersUsdSourceChoice('usd')).toBe(true)
    expect(offersUsdSourceChoice('eur')).toBe(false)
    expect(usdSourceChoices()).toEqual(['tcgplayer', 'cardkingdom'])
    seed(['tcgplayer'])
    expect(offersUsdSourceChoice('usd')).toBe(false)
  })
})

describe('the store in view', () => {
  test('opens on the configured default, and its currency follows', () => {
    seed(['tcgplayer', 'cardkingdom', 'cardmarket'], 'cardmarket')
    expect(activeStore()).toBe('cardmarket')
    expect(activeCurrency()).toBe('eur')
    expect(storeIsExplicit()).toBe(false)
  })

  test('a default the deployment does not offer opens on the first offered store', () => {
    seed(['cardmarket'], 'tcgplayer')
    expect(activeStore()).toBe('cardmarket')
  })

  test('a pick outlives every re-seed, and marks the choice explicit', () => {
    seed(['tcgplayer', 'cardmarket'])
    selectStore('cardmarket')
    seed(['tcgplayer', 'cardmarket'], 'tcgplayer')
    expect(activeStore()).toBe('cardmarket')
    expect(storeIsExplicit()).toBe(true)
  })

  test('a pick the store list took away settles on a store of the same currency', () => {
    seed(['tcgplayer', 'cardkingdom', 'cardmarket'])
    selectStore('cardkingdom')
    seed(['tcgplayer', 'cardmarket'], 'cardmarket')
    expect(activeStore()).toBe('tcgplayer')
    // …and on the default when nothing shares its currency.
    selectStore('cardhoarder')
    expect(activeStore()).toBe('cardmarket')
  })

  test('a Card Kingdom-only deployment reads Card Kingdom without any pick', () => {
    seed(['cardkingdom'])
    expect(activeStore()).toBe('cardkingdom')
    expect(activeUsdSource()).toBe('cardkingdom')
  })
})

describe("sell mode's courtesy Card Kingdom default", () => {
  test('switches a USD default to Card Kingdom, and leaving restores it', () => {
    seed(['tcgplayer', 'cardkingdom'])
    setSellModeActive(true)
    expect(activeStore()).toBe('cardkingdom')
    // A courtesy, not a pick: the URL sync must not write it into a link.
    expect(storeIsExplicit()).toBe(false)
    setSellModeActive(false)
    expect(activeStore()).toBe('tcgplayer')
  })

  test('never overrides a pick', () => {
    seed(['tcgplayer', 'cardkingdom'])
    selectStore('tcgplayer')
    setSellModeActive(true)
    expect(activeStore()).toBe('tcgplayer')
  })

  test('a pick this deployment cannot honour is no pick: the courtesy still applies', () => {
    // A link built for another deployment names a store with no offered sibling.
    seed(['tcgplayer', 'cardkingdom'])
    selectStore('cardmarket')
    expect(storeIsExplicit()).toBe(false)
    setSellModeActive(true)
    expect(activeStore()).toBe('cardkingdom')
  })

  test('leaves a non-USD view — and its currency — alone', () => {
    seed(['tcgplayer', 'cardkingdom', 'cardmarket'], 'cardmarket')
    setSellModeActive(true)
    expect(activeStore()).toBe('cardmarket')
    expect(activeCurrency()).toBe('eur')
  })

  test('does nothing when Card Kingdom is not offered', () => {
    seed(['tcgplayer'])
    setSellModeActive(true)
    expect(activeStore()).toBe('tcgplayer')
  })

  test('survives a re-seed: the admin re-seeds on every page mount', () => {
    seed(['tcgplayer', 'cardkingdom'])
    setSellModeActive(true)
    seed(['tcgplayer', 'cardkingdom'])
    expect(activeStore()).toBe('cardkingdom')
  })
})

describe('activeUsdSource', () => {
  test('is the store in view when it is a USD one', () => {
    seed(['tcgplayer', 'cardkingdom'])
    selectStore('cardkingdom')
    expect(activeUsdSource()).toBe('cardkingdom')
  })

  test('with EUR in view, is the USD store a dollar comparison reads', () => {
    seed(['tcgplayer', 'cardkingdom', 'cardmarket'], 'cardkingdom')
    selectStore('cardmarket')
    expect(activeUsdSource()).toBe('cardkingdom')
    seed(['tcgplayer', 'cardkingdom', 'cardmarket'], 'cardmarket')
    expect(activeUsdSource()).toBe('tcgplayer')
  })
})

describe('sitePriceForFinish', () => {
  test('reads Scryfall under the default source, in every currency', () => {
    seed(['tcgplayer', 'cardkingdom', 'cardmarket'])
    expect(sitePriceForFinish(card, 'foil', 'usd')).toBe(5)
    expect(sitePriceForFinish(card, 'nonfoil', 'eur')).toBe(1.5)
    expect(sitePrice(card, 'usd')).toBe(2)
  })

  test('reads CK retail from the quote store under the cardkingdom source — no fallback', () => {
    seed(['tcgplayer', 'cardkingdom'])
    selectStore('cardkingdom')
    seedRetail('tst:7:nonfoil', 3.75)
    expect(sitePriceForFinish(card, 'nonfoil', 'usd')).toBe(3.75)
    // The no-finish read resolves the printing's default finish (nonfoil here)
    // — the same key the bake requested for the entry.
    expect(sitePrice(card, 'usd')).toBe(3.75)
    // The foil has no CK product: honestly unpriced, never the Scryfall $5.
    expect(sitePriceForFinish(card, 'foil', 'usd')).toBe(0)
    // EUR is untouched by the USD source choice.
    expect(sitePriceForFinish(card, 'nonfoil', 'eur')).toBe(1.5)
  })
})
