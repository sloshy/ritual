import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { quoteKey } from '../../../src/buylist'
import type { BuylistQuoteRequest, BuylistQuotesResponse } from '../../../src/buylist'
import {
  buylistError,
  buylistLoading,
  buylistQuotesOnline,
  quoteFor,
  requestBuylistQuotes,
  resetBuylistFetcher,
  resetBuylistQuotes,
  setBuylistFetcher,
  setBuylistQuotesOnline,
} from '../../../src/site/buylist-quotes'
import {
  STUB_BUYLIST_FEED_CREATED_AT,
  makeBuylistQuote,
  stubBuylistFetcher,
} from '../../test-utils'
import type { StubBuylistFetcher } from '../../test-utils'

/**
 * The store's *live* half — the admin editors' path, where quotes are fetched
 * on demand rather than baked. What a request settles, and what resetting gives
 * back: the admin's **Refresh buylist** button resets the store precisely so a
 * printing it already settled is re-asked against the feed just downloaded.
 *
 * Seeding (the public site's path) is `buylist-seed.test.ts`.
 */

const SOL_RING: BuylistQuoteRequest = { set: 'c21', collectorNumber: '263', finish: 'nonfoil' }

let fetcher: StubBuylistFetcher

beforeEach(() => {
  fetcher = stubBuylistFetcher(1.25)
})

afterEach(() => {
  resetBuylistQuotes()
  // The transport is module-global and shared across every file in the run.
  resetBuylistFetcher()
})

describe('requestBuylistQuotes', () => {
  test('settles a printing once, so a second page never re-asks for it', async () => {
    await requestBuylistQuotes([SOL_RING])
    await requestBuylistQuotes([SOL_RING])

    expect(fetcher.calls()).toBe(1)
    expect(quoteFor('c21', '263', 'nonfoil')).toMatchObject({ priceBuy: 1.25 })
  })

  test('a failed request settles nothing, so the next one retries', async () => {
    fetcher.breakIt()
    await requestBuylistQuotes([SOL_RING])
    expect(buylistError()).toContain('503')

    await requestBuylistQuotes([SOL_RING])

    expect(fetcher.calls()).toBe(2)
  })
})

describe('buylistQuotesOnline', () => {
  test('survives a store reset, since going offline is not a data event', async () => {
    setBuylistQuotesOnline(true)
    await requestBuylistQuotes([SOL_RING])

    // A buyer switch resets the store. The printing pickers must not conclude
    // from that that the deployment lost its backend.
    resetBuylistQuotes()

    expect(buylistQuotesOnline()).toBe(true)
  })

  test('is cleared with the transport, so one file cannot leave the next online', () => {
    setBuylistQuotesOnline(true)
    resetBuylistFetcher()
    expect(buylistQuotesOnline()).toBe(false)
  })
})

describe('resetBuylistQuotes', () => {
  test('drops settled printings so the next request quotes the new feed', async () => {
    await requestBuylistQuotes([SOL_RING])
    // What the admin does when **Refresh buylist** actually downloads a new
    // feed: without this the store answers forever from the old one, since a
    // settled key is never asked about again.
    fetcher = stubBuylistFetcher(2.5)

    resetBuylistQuotes()
    expect(quoteFor('c21', '263', 'nonfoil')).toBeUndefined()
    await requestBuylistQuotes([SOL_RING])

    expect(fetcher.calls()).toBe(1)
    expect(quoteFor('c21', '263', 'nonfoil')).toMatchObject({ priceBuy: 2.5 })
  })

  test('a reset landing mid-request invalidates the straggler entirely', async () => {
    // The **Refresh buylist** button is the first caller of the reset from
    // *outside* a request, so this race is newly reachable: engage sell mode on
    // a large list, then click Refresh while its batches are still in flight.
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    setBuylistFetcher(async (buyer): Promise<BuylistQuotesResponse> => {
      await held
      return {
        success: true,
        buyer,
        // The straggler carries a real quote from the OLD feed, so writing it
        // through would both show a stale price and mark the key settled —
        // silencing every re-ask against the feed the reset was for.
        quotes: {
          [quoteKey(SOL_RING.set, SOL_RING.collectorNumber, SOL_RING.finish)]: makeBuylistQuote({
            priceBuy: 1.25,
          }),
        },
        feedCreatedAt: STUB_BUYLIST_FEED_CREATED_AT,
        feedRetrievedAt: Date.now(),
        stale: false,
        productCount: 1,
      }
    })

    const inFlight = requestBuylistQuotes([SOL_RING])
    expect(buylistLoading()).toBe(true)
    resetBuylistQuotes()
    release!()
    await inFlight

    // The stale response must not be written: the store stays empty…
    expect(quoteFor('c21', '263', 'nonfoil')).toBeUndefined()
    // …and without the generation token the straggler's decrement would take
    // the count the reset zeroed to -1, and every later request would go
    // -1 → 0 → -1, never reaching the `=== 0` that clears the spinner.
    expect(buylistLoading()).toBe(false)

    // Nor marked resolved: the same printing is genuinely re-asked, and quotes
    // at the NEW feed's price.
    fetcher = stubBuylistFetcher(2.5)
    await requestBuylistQuotes([SOL_RING])
    expect(fetcher.calls()).toBe(1)
    expect(quoteFor('c21', '263', 'nonfoil')).toMatchObject({ priceBuy: 2.5 })
    expect(buylistLoading()).toBe(false)
  })
})
