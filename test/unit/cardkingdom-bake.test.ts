import { describe, expect, test } from 'bun:test'
import { buildCardKingdomIndex, detailBuylistContext } from '../../src/cardkingdom'
import type { LoadedCardKingdomFeed } from '../../src/cardkingdom'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../test-utils'

/**
 * The one producer of a `DetailBuylistContext` — the seam `build-site` and the
 * live server both quote through, which is what keeps a static build and
 * `serve --api` from ever pricing the same printing differently.
 *
 * Matching itself is pinned against the engine in buylist-quote.test.ts; this
 * covers only what the adapter adds: the buyer it names, the stamps it carries
 * over from the cache file, and that it quotes from the loaded feed alone.
 */

/** A loaded feed over `products`, downloaded at `retrievedAt`. */
function loadFeed(
  products: ReturnType<typeof makeCardKingdomProduct>[],
  retrievedAt = 1785850800000,
): LoadedCardKingdomFeed {
  const file = makeCardKingdomCacheFile(products, retrievedAt)
  return { file, index: buildCardKingdomIndex(file.feed.products) }
}

const boltProduct = makeCardKingdomProduct({
  id: 7,
  sku: 'LEA-0161',
  scryfallId: 'bolt-lea',
  name: 'Lightning Bolt',
  edition: 'Limited Edition Alpha',
  finish: 'nonfoil',
  priceBuy: 12.5,
  qtyBuying: 6,
})

describe('detailBuylistContext', () => {
  test('quotes a printing from the loaded feed and carries the feed stamps', () => {
    const loaded = loadFeed([boltProduct])

    const ctx = detailBuylistContext(loaded)

    expect(ctx.buyer).toBe('cardkingdom')
    expect(ctx.feedCreatedAt).toBe(loaded.file.feed.createdAt)
    expect(ctx.feedRetrievedAt).toBe(1785850800000)
    expect(
      ctx.quote({
        set: 'lea',
        collectorNumber: '161',
        finish: 'nonfoil',
        scryfallId: 'bolt-lea',
      }),
    ).toMatchObject({ productId: 7, priceBuy: 12.5, buying: true, finish: 'nonfoil' })
  })

  test('returns null for a printing the buyer has no product for', () => {
    const ctx = detailBuylistContext(loadFeed([boltProduct]))

    // Sparse by design: a detail bakes no entry at all for an unquoted
    // printing, rather than a zero-priced one.
    expect(ctx.quote({ set: 'lea', collectorNumber: '999', finish: 'nonfoil' })).toBeNull()
    // The right printing in a finish the buyer does not stock is the same case.
    expect(
      ctx.quote({
        set: 'lea',
        collectorNumber: '161',
        finish: 'foil',
        scryfallId: 'bolt-lea',
      }),
    ).toBeNull()
  })

  test('each context answers from its own loaded feed, not from the process memo', () => {
    // The property the file header claims: the adapter closes over the feed it
    // was handed. Two contexts alive at once — a build that adopted a fresh
    // download beside a server still serving the cached one — must not answer
    // each other's questions.
    const empty = detailBuylistContext(loadFeed([], 1785850800000))
    const stocked = detailBuylistContext(loadFeed([boltProduct], 1785937200000))

    const bolt = { set: 'lea', collectorNumber: '161', finish: 'nonfoil' } as const
    expect(empty.quote(bolt)).toBeNull()
    expect(stocked.quote(bolt)).toMatchObject({ productId: 7 })
    expect(empty.feedRetrievedAt).toBe(1785850800000)
    expect(stocked.feedRetrievedAt).toBe(1785937200000)
  })
})
