import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../../src/cache'
import { refreshRitualConfig } from '../../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { handlePriceList, type PriceListDetailResponse } from '../../../src/admin/api/price'
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

describe('GET /api/price/:type/:slug — ?source=', () => {
  test('source=cardkingdom prices from the cached feed and stamps the payload', async () => {
    await writeLists()
    await seedCache()
    await seedFeedCache()
    const resp = await handlePriceList(listRequest('collection', 'binder', '?source=cardkingdom'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceListDetailResponse
    expect(body.source).toBe('cardkingdom')
    expect(body.currency).toBe('usd')
    expect(body.cards[0]?.price).toBeCloseTo(6.25)
    expect(body.list.total).toBeCloseTo(6.25)
  })

  test('an unknown source is a 400', async () => {
    await writeLists()
    const unknown = await handlePriceList(listRequest('collection', 'binder', '?source=ebay'))
    expect(unknown.status).toBe(400)
  })

  test('source=cardkingdom with no cached feed is a 503 with the refresh remedy', async () => {
    await writeLists()
    await seedCache()
    const resp = await handlePriceList(listRequest('collection', 'binder', '?source=cardkingdom'))
    expect(resp.status).toBe(503)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.message).toContain('No Card Kingdom buylist')
    expect(body.messageKey).toBe('domain.cache.cardKingdom.missingApiAdvice')
  })

  test('with no ?source=, the configured defaultPriceSource sets the store', async () => {
    await writeLists()
    await seedCache()
    await fs.writeFile(
      path.join(ws.dir, 'ritual.config.json'),
      JSON.stringify({ defaultPriceSource: 'cardmarket' }),
    )
    await refreshRitualConfig()
    const resp = await handlePriceList(listRequest('collection', 'binder'))
    const body = (await resp.json()) as PriceListDetailResponse
    expect(body.source).toBe('cardmarket')
    expect(body.currency).toBe('eur')
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

  test("prices a single list at the requested store, in that store's currency", async () => {
    await writeLists()
    await seedCache()

    const resp = await handlePriceList(listRequest('collection', 'binder', '?source=CardMarket'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceListDetailResponse
    expect(body.success).toBe(true)
    expect(body.source).toBe('cardmarket')
    expect(body.currency).toBe('eur')
    expect(typeof body.lastRefreshedAt).toBe('number')
    expect(body.warnings).toEqual([])

    expect(body.list.slug).toBe('binder')
    expect(body.list.name).toBe('Binder')
    expect(body.list.cardCount).toBe(1)
    expect(body.list.total).toBeCloseTo(4.0)
    // One price body, so no discriminant rides along.
    expect('mode' in body).toBe(false)

    expect(body.cards).toHaveLength(1)
    const card = body.cards[0]!
    expect(card.name).toBe('Test Card')
    expect(card.set).toBe('tst')
    expect(card.collectorNumber).toBe('1')
    expect(card.pinned).toBe(true)
    expect(card.price).toBeCloseTo(4.0)
  })

  test('a line the parser cannot read is a warning message naming its list', async () => {
    await fs.writeFile(
      path.join(ws.dir, 'collections', 'binder.md'),
      ['# Binder', '', '- Test Card (TST:1) &1', '- Test Card (TST:1) &2 [nonsense', ''].join('\n'),
    )
    await seedCache()
    const resp = await handlePriceList(listRequest('collection', 'binder'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as PriceListDetailResponse
    expect(body.warnings).toHaveLength(1)
    const [warning] = body.warnings
    expect(warning?.messageKey).toBe('domain.price.inList')
    expect(warning?.message).toStartWith('Binder: ')
    expect(warning?.list).toEqual({ listType: 'collection', slug: 'binder' })
    // The line's own diagnostic, nested whole under the list's name.
    expect(warning?.messageParams?.cause).toMatchObject({ messageKey: 'domain.card.line.atLine' })
  })
})
