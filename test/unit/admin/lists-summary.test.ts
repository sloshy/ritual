import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../../src/cache'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import {
  handleListsSummary,
  parseListsSummaryParams,
  type ListsSummaryResponse,
} from '../../../src/admin/api/lists'
import type { ApiErrorResponse } from '../../../src/api/http'
import { isApiMessage } from '../../../src/api/result'
import type { MessageKey } from '../../../src/i18n/messages/en'
import {
  makeCardKingdomCacheFile,
  makeCardKingdomProduct,
  makeScryfallCard,
} from '../../test-utils'

/**
 * GET /api/lists/summary wiring: query parsing, the refusals, and how a store
 * that cannot price is reported. The summary's own semantics (selection,
 * counting, totals, sorting) are pinned in test/unit/list-summary.test.ts.
 */

const BINDER_MD = ['# Binder', '', '- Test Card (TST:1) &1', ''].join('\n')
const BURN_MD = ['---', 'name: Burn', '---', '', '## Main', '', '2 Test Card &1', ''].join('\n')

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ clearCardCache: true })
  await fs.writeFile(path.join(ws.dir, 'collections', 'binder.md'), BINDER_MD)
  await fs.writeFile(path.join(ws.dir, 'decks', 'burn.md'), BURN_MD)
})

afterEach(async () => {
  await ws.dispose()
})

async function summary(query = ''): Promise<Response> {
  return handleListsSummary(new Request(`http://localhost/api/lists/summary${query}`))
}

describe('parseListsSummaryParams', () => {
  test('every parameter parses into its option; repeated ones each add one', () => {
    const parsed = parseListsSummaryParams(
      new URLSearchParams(
        [
          'listType=deck',
          'nameContains=%20stax%20',
          'list=deck:Winota, Stax',
          'list=deck:burn',
          'label=PROXY',
          'includeEmpty=false',
          'format=commander',
          'section=Main',
          'section=Commander',
          'source=cardmarket',
          'sort=value',
          'descending=FALSE',
          'limit=3',
        ].join('&'),
      ),
    )
    expect(parsed).toEqual({
      listType: 'deck',
      nameContains: 'stax',
      // A slug may hold a comma: only the first colon splits a ref.
      lists: [
        { listType: 'deck', slug: 'Winota, Stax' },
        { listType: 'deck', slug: 'burn' },
      ],
      label: 'proxy',
      includeEmpty: false,
      format: 'commander',
      sections: ['Main', 'Commander'],
      source: 'cardmarket',
      sort: 'value',
      descending: false,
      limit: 3,
    })
  })

  test('blank parameters are absent, but a repeated list given only blanks is []', () => {
    expect(parseListsSummaryParams(new URLSearchParams('label=&sort=%20&list=&list=%20'))).toEqual({
      lists: [],
    })
  })

  test.each<[string, MessageKey, string]>([
    ['listType=box', 'errors.enum.invalid', 'listType'],
    ['label=shiny', 'errors.enum.invalid', 'label'],
    ['format=pauper2', 'errors.enum.invalid', 'format'],
    ['sort=price', 'errors.enum.invalid', 'sort'],
    ['source=ebay', 'errors.enum.invalid', 'source'],
    ['includeEmpty=yes', 'errors.enum.invalid', 'includeEmpty'],
    ['descending=1', 'errors.enum.invalid', 'descending'],
    ['limit=0', 'admin.api.field.notPositiveInteger', 'limit'],
  ])('%s is refused, naming its parameter', (query, messageKey, field) => {
    const parsed = parseListsSummaryParams(new URLSearchParams(query))
    if (!isApiMessage(parsed)) throw new Error(`accepted ${query}`)
    expect(parsed.messageKey).toBe(messageKey)
    expect(parsed.messageParams?.field).toBe(field)
  })

  test('a ref’s type is matched case-insensitively, and a ref named twice is kept once', () => {
    expect(parseListsSummaryParams(new URLSearchParams('list=Deck:burn&list=deck:burn'))).toEqual({
      lists: [{ listType: 'deck', slug: 'burn' }],
    })
  })

  test.each(['list=box:binder', 'list=deck:'])('%s is refused as a bad list ref', (query) => {
    const parsed = parseListsSummaryParams(new URLSearchParams(query))
    if (!isApiMessage(parsed)) throw new Error(`accepted ${query}`)
    expect(parsed.messageKey).toBe('admin.api.listRefInvalid')
  })
})

describe('GET /api/lists/summary', () => {
  test('counts without a store, never touching the empty card cache', async () => {
    const resp = await summary()
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as ListsSummaryResponse
    expect(body.success).toBe(true)
    expect(body.totals).toMatchObject({ listCount: 2, entryCount: 2, cardCount: 3 })
    expect(body.typeTotals?.map((totals) => totals.listType)).toEqual(['deck', 'collection'])
    expect(body.source).toBeUndefined()
    expect('lastRefreshedAt' in body).toBe(false)
    expect(body.warnings).toEqual([])
  })

  test('with a store, values every row and stamps the cache age', async () => {
    await cardCache.bulkSet({
      'Test Card': [makeScryfallCard({ prices: { usd: '2.50', eur: '4.00' } })],
    })
    const resp = await summary('?source=cardmarket&sort=value&limit=1')
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as ListsSummaryResponse
    expect(body.source).toBe('cardmarket')
    expect(body.currency).toBe('eur')
    expect(typeof body.lastRefreshedAt).toBe('number')
    // The deck's two copies outvalue the binder's one; limit trims rows, not totals.
    expect(body.lists.map((row) => row.slug)).toEqual(['burn'])
    expect(body.totals.value?.total).toBeCloseTo(12)
  })

  test('a malformed parameter is a 400', async () => {
    const resp = await summary('?limit=0')
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.messageKey).toBe('admin.api.field.notPositiveInteger')
  })

  test("an engine refusal is a 400 carrying the engine's message", async () => {
    const resp = await summary('?sort=value')
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.messageKey).toBe('domain.list.summary.sortNeedsPricing')
  })

  test("a Card Kingdom value's age is the feed's download, not the card cache's", async () => {
    await cardCache.bulkSet({ 'Test Card': [makeScryfallCard({ prices: { usd: '2.50' } })] })
    const retrievedAt = Date.parse('2026-07-01T08:00:00Z')
    const feed = makeCardKingdomCacheFile(
      [makeCardKingdomProduct({ scryfallId: 'test-id', priceRetail: 6.25, qtyRetail: 2 })],
      retrievedAt,
    )
    await fs.mkdir(path.join(ws.dir, 'cache'), { recursive: true })
    await fs.writeFile(path.join(ws.dir, 'cache', 'cardkingdom.json'), JSON.stringify(feed))
    const body = (await (await summary('?source=cardkingdom')).json()) as ListsSummaryResponse
    expect(body.source).toBe('cardkingdom')
    expect(body.lastRefreshedAt).toBe(retrievedAt)
  })

  test('a value sort over an empty card cache is refused (503), like a store with no prices', async () => {
    const resp = await summary('?source=cardmarket&sort=value')
    expect(resp.status).toBe(503)
    expect(((await resp.json()) as ApiErrorResponse).messageKey).toBe(
      'domain.list.summary.cacheEmpty',
    )
  })

  test('Card Kingdom with no cached feed keeps the counts and warns first', async () => {
    const resp = await summary('?source=cardkingdom')
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as ListsSummaryResponse
    expect(body.totals.cardCount).toBe(3)
    expect(body.source).toBeUndefined()
    expect(body.warnings[0]?.messageKey).toBe('domain.cache.cardKingdom.missingApiAdvice')
  })

  test('Card Kingdom with no cached feed refuses a value sort it cannot honor', async () => {
    const resp = await summary('?source=cardkingdom&sort=value')
    expect(resp.status).toBe(503)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.messageKey).toBe('domain.cache.cardKingdom.missingApiAdvice')
  })
})
