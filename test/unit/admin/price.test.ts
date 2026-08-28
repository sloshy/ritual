import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../../src/cache'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import {
  handlePriceList,
  handlePriceSummary,
  type PriceListDetailResponse,
  type PriceSummaryResponse,
} from '../../../src/admin/api/price'
import type { ApiErrorResponse } from '../../../src/api/http'
import {
  makeCardKingdomCacheFile,
  makeCardKingdomProduct,
  makeScryfallCard,
} from '../../test-utils'

/**
 * Handler tests for the admin price endpoints. Prices are served strictly from
 * the local card cache, so an empty cache is a 503 (never a download prompt);
 * the happy paths seed the module-level card cache with synthetic printings.
 */

const BINDER_MD = ['# Binder', '', '- Test Card (TST:1) &1', ''].join('\n')

const BURN_MD = ['---', 'name: Burn', '---', '', '## Main', '', '2 Test Card &1', ''].join('\n')

/** One nonfoil printing of "Test Card" at TST:1, priced in USD and EUR. */
const TEST_CARD_PRINTINGS = [makeScryfallCard({ prices: { usd: '2.50', eur: '4.00' } })]

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ clearCardCache: true })
})

afterEach(async () => {
  await ws.dispose()
})

async function writeLists(): Promise<void> {
  await fs.writeFile(path.join(ws.dir, 'collections', 'binder.md'), BINDER_MD)
  await fs.writeFile(path.join(ws.dir, 'decks', 'burn.md'), BURN_MD)
}

/** Seed the card cache via bulkSet so `lastRefreshedAt` metadata is stamped too. */
async function seedCache(): Promise<void> {
  await cardCache.bulkSet({ 'Test Card': TEST_CARD_PRINTINGS })
}

function summaryRequest(query = ''): Request {
  return new Request(`http://localhost/api/price/summary${query}`)
}

function listRequest(type: string, slug: string, query = ''): Request {
  return new Request(`http://localhost/api/price/${type}/${slug}${query}`)
}

/** A CK feed cache whose one product matches TST:1 by Scryfall id at $6.25 NM retail. */
async function seedFeedCache(): Promise<void> {
  const file = makeCardKingdomCacheFile([
    makeCardKingdomProduct({ scryfallId: 'test-id', priceRetail: 6.25, qtyRetail: 2 }),
  ])
  await fs.mkdir(path.join(ws.dir, 'cache'), { recursive: true })
  await fs.writeFile(path.join(ws.dir, 'cache', 'cardkingdom.json'), JSON.stringify(file))
}

describe('GET /api/price/summary — ?source=', () => {
  test('source=cardkingdom prices from the cached feed and stamps the payload', async () => {
    await writeLists()
    await seedCache()
    await seedFeedCache()
    const resp = await handlePriceSummary(summaryRequest('?source=cardkingdom'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceSummaryResponse
    expect(body.currency).toBe('usd')
    expect(body.source).toBe('cardkingdom')
    // Binder: 1 copy at CK retail; the deck's unpinned copies quote CK too.
    const binder = body.lists.find((l) => l.name === 'binder')
    expect(binder?.total).toBeCloseTo(6.25)
  })

  test('source=cardmarket is Scryfall EUR with no source stamp', async () => {
    await writeLists()
    await seedCache()
    const resp = await handlePriceSummary(summaryRequest('?source=cardmarket'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceSummaryResponse
    expect(body.currency).toBe('eur')
    expect(body.source).toBeUndefined()
  })

  test('an unknown source is a 400, and so is a conflicting currency', async () => {
    await writeLists()
    const unknown = await handlePriceSummary(summaryRequest('?source=ebay'))
    expect(unknown.status).toBe(400)
    const conflict = await handlePriceSummary(summaryRequest('?source=cardkingdom&currency=eur'))
    expect(conflict.status).toBe(400)
    const conflictBody = (await conflict.json()) as ApiErrorResponse
    expect(conflictBody.message).toContain('usd')
  })

  test('source=cardkingdom with no cached feed is a 503 with the refresh remedy', async () => {
    await writeLists()
    await seedCache()
    const resp = await handlePriceSummary(summaryRequest('?source=cardkingdom'))
    expect(resp.status).toBe(503)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.message).toContain('No Card Kingdom buylist')
  })
})

describe('GET /api/price/:type/:slug — ?source=', () => {
  test('the single-list view takes the same source parameter', async () => {
    await writeLists()
    await seedCache()
    await seedFeedCache()
    const resp = await handlePriceList(listRequest('collection', 'binder', '?source=cardkingdom'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceListDetailResponse
    expect(body.source).toBe('cardkingdom')
    expect(body.cards[0]?.price).toBeCloseTo(6.25)
  })
})

describe('GET /api/price/summary', () => {
  test('returns 503 when the card cache is empty', async () => {
    await writeLists()
    const resp = await handlePriceSummary(summaryRequest())
    expect(resp.status).toBe(503)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.success).toBe(false)
    expect(body.message).toContain('cache is empty')
  })

  test('returns 400 for an invalid type', async () => {
    const resp = await handlePriceSummary(summaryRequest('?type=bogus'))
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ApiErrorResponse).success).toBe(false)
  })

  test('returns 400 for an invalid currency', async () => {
    const resp = await handlePriceSummary(summaryRequest('?currency=gbp'))
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ApiErrorResponse).success).toBe(false)
  })

  test('prices every list with per-type and grand totals', async () => {
    await writeLists()
    await seedCache()

    const resp = await handlePriceSummary(summaryRequest())
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceSummaryResponse
    expect(body.success).toBe(true)
    expect(body.currency).toBe('usd')
    expect(typeof body.lastRefreshedAt).toBe('number')
    expect(body.warnings).toEqual([])

    expect(body.lists.map((l) => `${l.type}:${l.name}`).sort()).toEqual([
      'collection:binder',
      'deck:burn',
    ])
    const binder = body.lists.find((l) => l.name === 'binder')!
    expect(binder.cardCount).toBe(1)
    expect(binder.total).toBeCloseTo(2.5)

    const deckTotals = body.typeTotals.find((t) => t.type === 'deck')!
    expect(deckTotals.listCount).toBe(1)
    expect(deckTotals.total).toBeCloseTo(5.0)

    // Grand totals: 1 collection copy + 2 deck copies at $2.50 each.
    expect(body.totals.listCount).toBe(2)
    expect(body.totals.cardCount).toBe(3)
    expect(body.totals.total).toBeCloseTo(7.5)
  })

  test('?type= restricts the report to one list type', async () => {
    await writeLists()
    await seedCache()

    const resp = await handlePriceSummary(summaryRequest('?type=collection'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceSummaryResponse
    expect(body.lists.map((l) => l.type)).toEqual(['collection'])
    expect(body.typeTotals.map((t) => t.type)).toEqual(['collection'])
  })
})

describe('GET /api/price/:type/:slug', () => {
  test('returns 400 for an invalid list type in the path', async () => {
    const resp = await handlePriceList(listRequest('bogus', 'binder'))
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as ApiErrorResponse).success).toBe(false)
  })

  test('returns 404 for an unknown slug', async () => {
    await writeLists()
    const resp = await handlePriceList(listRequest('collection', 'ghost'))
    expect(resp.status).toBe(404)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.success).toBe(false)
    expect(body.message).toContain('ghost')
  })

  test('returns 503 when the card cache is empty', async () => {
    await writeLists()
    const resp = await handlePriceList(listRequest('collection', 'binder'))
    expect(resp.status).toBe(503)
    expect(((await resp.json()) as ApiErrorResponse).message).toContain('cache is empty')
  })

  test('prices a single list in the requested currency', async () => {
    await writeLists()
    await seedCache()

    const resp = await handlePriceList(listRequest('collection', 'binder', '?currency=EUR'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceListDetailResponse
    expect(body.success).toBe(true)
    expect(body.currency).toBe('eur')
    expect(typeof body.lastRefreshedAt).toBe('number')
    expect(body.warnings).toEqual([])

    expect(body.list?.name).toBe('binder')
    expect(body.list?.cardCount).toBe(1)
    expect(body.list?.total).toBeCloseTo(4.0)

    expect(body.cards).toHaveLength(1)
    const card = body.cards[0]!
    expect(card.name).toBe('Test Card')
    expect(card.set).toBe('tst')
    expect(card.collectorNumber).toBe('1')
    expect(card.pinned).toBe(true)
    expect(card.price).toBeCloseTo(4.0)
  })
})
