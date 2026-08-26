import { afterEach, describe, expect, test } from 'bun:test'
import {
  BUYLIST_FEED_MAX_AGE_MS,
  buylistFeedIsStale,
  type BuylistQuote,
} from '../../../src/buylist'
import {
  buylistError,
  buylistFeedInfo,
  quoteFor,
  reportBuylistUnavailable,
  requestBuylistQuotes,
  resetBuylistFetcher,
  resetBuylistQuotes,
  seedBuylistQuotes,
} from '../../../src/list-view/buylist-quotes'
import type { BakedBuylist } from '../../../src/list/site-data'
import { makeBuylistQuote, stubBuylistFetcher } from '../../test-utils'

/**
 * The public site's only source of quotes: the buylist map baked into a list
 * detail, loaded straight into the store instead of fetched.
 *
 * Solid effects do not run under `bun test` (solid-js resolves to its server
 * build), so nothing here drives a component — these are signal reads against
 * the module store, which is exactly the layer the seeding rules live at.
 */

const FEED_CREATED_AT = '2026-08-04 06:06:09'

/** The shared fixture, named for what this file's quotes stand for. */
const makeQuote = (overrides: Partial<BuylistQuote> = {}): BuylistQuote =>
  makeBuylistQuote({ name: 'Sol Ring', edition: 'Commander 2021', ...overrides })

/** A baked payload for Card Kingdom, downloaded `ageMs` ago. */
function baked(quotes: Record<string, BuylistQuote>, ageMs = 0): BakedBuylist {
  return {
    cardkingdom: {
      quotes,
      feedCreatedAt: FEED_CREATED_AT,
      feedRetrievedAt: Date.now() - ageMs,
    },
  }
}

afterEach(() => {
  resetBuylistQuotes()
  // The transport is module-global and shared across every file in the run.
  resetBuylistFetcher()
})

describe('buylistFeedIsStale', () => {
  test('a feed is fresh right up to the max age, and stale past it', () => {
    const retrievedAt = 1785850800000

    expect(buylistFeedIsStale(retrievedAt, retrievedAt + BUYLIST_FEED_MAX_AGE_MS)).toBe(false)
    expect(buylistFeedIsStale(retrievedAt, retrievedAt + BUYLIST_FEED_MAX_AGE_MS + 1)).toBe(true)
  })
})

describe('seedBuylistQuotes', () => {
  test('loads the buyer’s baked quotes and stamps the feed', () => {
    seedBuylistQuotes(baked({ 'c21:263:nonfoil': makeQuote({ priceBuy: 1.25 }) }))

    expect(quoteFor('c21', '263', 'nonfoil')).toMatchObject({ priceBuy: 1.25 })
    expect(quoteFor('c21', '263', 'foil')).toBeUndefined()
    expect(buylistFeedInfo()).toMatchObject({ feedCreatedAt: FEED_CREATED_AT, stale: false })
  })

  test('derives staleness from the download stamp rather than baking it', () => {
    // A built site is served for days: a `stale` flag frozen at build time
    // would keep claiming freshness long after the offers moved.
    seedBuylistQuotes(baked({}, BUYLIST_FEED_MAX_AGE_MS + 60_000))

    expect(buylistFeedInfo()?.stale).toBe(true)
  })

  test('re-seeding the same payload writes nothing', () => {
    const payload = baked({ 'c21:263:nonfoil': makeQuote() })
    seedBuylistQuotes(payload)
    const first = buylistFeedInfo()

    seedBuylistQuotes(payload)

    // Identity, not equality: a fresh stamp object would count as a change and
    // re-run every card memo on the page, and pages re-seed on every engage,
    // buyer change and detail refetch.
    expect(buylistFeedInfo()).toBe(first)
    expect(quoteFor('c21', '263', 'nonfoil')).toBe(payload.cardkingdom!.quotes['c21:263:nonfoil'])
  })

  test('merges a second list’s quotes without dropping the first’s', () => {
    // What a combined view does: one seed per loaded detail into one store.
    seedBuylistQuotes(baked({ 'c21:263:nonfoil': makeQuote({ priceBuy: 1 }) }))
    seedBuylistQuotes(baked({ 'lea:161:foil': makeQuote({ priceBuy: 30, finish: 'foil' }) }))

    expect(quoteFor('c21', '263', 'nonfoil')).toMatchObject({ priceBuy: 1 })
    expect(quoteFor('lea', '161', 'foil')).toMatchObject({ priceBuy: 30 })
  })

  test('a payload with nothing for the buyer leaves the store as it was', () => {
    seedBuylistQuotes(baked({ 'c21:263:nonfoil': makeQuote() }))
    const stamp = buylistFeedInfo()

    // A future buyer the build never quoted against: seeding nothing beats
    // clearing quotes the page is still showing.
    seedBuylistQuotes({})

    expect(quoteFor('c21', '263', 'nonfoil')).toBeDefined()
    expect(buylistFeedInfo()).toBe(stamp)
  })

  test('a successful seed clears the “nothing baked” explanation', () => {
    reportBuylistUnavailable('This list was built without buylist data.')
    expect(buylistError()).toBe('This list was built without buylist data.')

    seedBuylistQuotes(baked({ 'c21:263:nonfoil': makeQuote() }))

    expect(buylistError()).toBeNull()
  })

  test('baked keys count as answered, so a later request asks for nothing', async () => {
    const fetcher = stubBuylistFetcher(1.25)
    seedBuylistQuotes(baked({ 'c21:263:nonfoil': makeQuote() }))

    // The admin site still quotes on demand against the same store; a printing
    // a baked list already settled must not be re-asked.
    await requestBuylistQuotes([{ set: 'c21', collectorNumber: '263', finish: 'nonfoil' }])

    expect(fetcher.calls()).toBe(0)
  })
})
