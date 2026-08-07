import { describe, expect, test } from 'bun:test'
import { buildCardKingdomIndex, quoteForPrinting } from '../../src/cardkingdom'
import type { CardKingdomFeed } from '../../src/cardkingdom'
import { makeCardKingdomProduct } from '../test-utils'

const FEED: Pick<CardKingdomFeed, 'baseUrl'> = { baseUrl: 'https://www.cardkingdom.com/' }

describe('quoteForPrinting', () => {
  test('matches by scryfall id, filtered to the requested finish', () => {
    const index = buildCardKingdomIndex([
      makeCardKingdomProduct({
        id: 1,
        scryfallId: 'abc',
        sku: 'DSK-0136',
        finish: 'nonfoil',
        priceBuy: 2.5,
        qtyBuying: 8,
      }),
      makeCardKingdomProduct({
        id: 2,
        scryfallId: 'abc',
        sku: 'FDSK-0136',
        finish: 'foil',
        priceBuy: 9,
        qtyBuying: 4,
      }),
    ])

    // Deliberately the cheaper of the two: without the finish filter,
    // `chooseProduct` would return the better-paying foil, so this fails if the
    // filter is dropped.
    const quote = quoteForPrinting(index, FEED, {
      set: 'dsk',
      collectorNumber: '136',
      finish: 'nonfoil',
      scryfallId: 'abc',
    })

    expect(quote).toMatchObject({
      productId: 1,
      priceBuy: 2.5,
      finish: 'nonfoil',
      matchVia: 'scryfall-id',
      buying: true,
      ambiguous: undefined,
    })
  })

  test('falls back to the sku printing index when the scryfall id is unknown', () => {
    const index = buildCardKingdomIndex([
      makeCardKingdomProduct({ id: 3, scryfallId: '', sku: 'DSK-0136', finish: 'nonfoil' }),
    ])

    const quote = quoteForPrinting(index, FEED, {
      set: 'dsk',
      collectorNumber: '136',
      finish: 'nonfoil',
      scryfallId: 'not-in-feed',
    })

    expect(quote).toMatchObject({ productId: 3, matchVia: 'sku' })
  })

  test('is null when the buyer has no product for the printing', () => {
    const index = buildCardKingdomIndex([
      makeCardKingdomProduct({ id: 4, scryfallId: 'other', sku: 'FDN-0001' }),
    ])

    expect(
      quoteForPrinting(index, FEED, { set: 'dsk', collectorNumber: '136', finish: 'nonfoil' }),
    ).toBeNull()
  })

  test('never quotes a non-English request — the feed is English-only', () => {
    const index = buildCardKingdomIndex([
      makeCardKingdomProduct({
        id: 8,
        scryfallId: 'abc',
        sku: 'DSK-0136',
        finish: 'nonfoil',
        priceBuy: 2.5,
        qtyBuying: 8,
      }),
    ])

    // Both join keys would hit; the language alone must short-circuit them.
    expect(
      quoteForPrinting(index, FEED, {
        set: 'dsk',
        collectorNumber: '136',
        finish: 'nonfoil',
        scryfallId: 'abc',
        language: 'ja',
      }),
    ).toBeNull()

    // An explicit en behaves exactly like an absent language.
    expect(
      quoteForPrinting(index, FEED, {
        set: 'dsk',
        collectorNumber: '136',
        finish: 'nonfoil',
        scryfallId: 'abc',
        language: 'en',
      }),
    ).toMatchObject({ productId: 8 })
  })

  test('reports a paused offer as not buying rather than omitting it', () => {
    const index = buildCardKingdomIndex([
      makeCardKingdomProduct({
        id: 5,
        scryfallId: 'abc',
        sku: 'DSK-0136',
        priceBuy: 3,
        qtyBuying: 0,
      }),
    ])

    const quote = quoteForPrinting(index, FEED, {
      set: 'dsk',
      collectorNumber: '136',
      finish: 'nonfoil',
      scryfallId: 'abc',
    })

    expect(quote).toMatchObject({ buying: false, priceBuy: 3, qtyBuying: 0 })
  })

  test('prefers an actively-buying product over a better-paying paused one, and flags the choice', () => {
    const index = buildCardKingdomIndex([
      makeCardKingdomProduct({
        id: 6,
        scryfallId: 'abc',
        sku: 'DSK-0136',
        priceBuy: 50,
        qtyBuying: 0,
      }),
      makeCardKingdomProduct({
        id: 7,
        scryfallId: 'abc',
        sku: 'DSK-0136',
        priceBuy: 0.02,
        qtyBuying: 4,
      }),
    ])

    const quote = quoteForPrinting(index, FEED, {
      set: 'dsk',
      collectorNumber: '136',
      finish: 'nonfoil',
      scryfallId: 'abc',
    })

    expect(quote).toMatchObject({ productId: 7, priceBuy: 0.02, ambiguous: true })
  })
})
