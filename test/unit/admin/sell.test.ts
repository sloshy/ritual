import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../../src/cache'
import { handleSellCart, handleSellReport } from '../../../src/admin/api/sell'
import type { SellReportResponse } from '../../../src/admin/api/sell'
import { setupRitualTestEnv, type RitualTestEnv } from '../mcp/harness'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../../test-utils'

/**
 * Handler-only validation coverage: the query parsers in
 * src/admin/api/sell.ts are unreachable from the MCP tools (whose zod schemas
 * reject bad input first) and from the CLI (which builds its own filters), so
 * they are pinned here with crafted requests. Report/matching semantics live
 * in test/unit/sell-report.test.ts; tool wiring in test/unit/mcp/sell-tools.test.ts.
 */

async function seedFeed(dir: string, scryfallId: string): Promise<void> {
  await fs.mkdir(path.join(dir, 'cache'), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'cache', 'cardkingdom.json'),
    JSON.stringify(
      makeCardKingdomCacheFile([
        makeCardKingdomProduct({ scryfallId, name: 'Sol Ring', edition: 'Alpha', priceBuy: 4 }),
      ]),
    ),
  )
}

function report(query: string): Promise<Response> {
  return handleSellReport(new Request(`http://localhost/api/sell/report${query}`))
}

describe('admin sell handlers', () => {
  let env: RitualTestEnv

  beforeEach(async () => {
    env = await setupRitualTestEnv()
    const printing = ((await cardCache.get('Sol Ring')) ?? [])[0]!
    await fs.writeFile(
      path.join(env.dir, 'collections', 'shoebox.md'),
      `# Shoebox\n\n- Sol Ring (${printing.set.toUpperCase()}:${printing.collector_number}) &1\n`,
    )
    await seedFeed(env.dir, printing.id)
  })

  afterEach(async () => {
    await env.cleanup()
  })

  test('rejects a bad type, a malformed or empty lists ref, and a bad min', async () => {
    expect((await report('?type=binder')).status).toBe(400)
    expect((await report('?lists=nonsense')).status).toBe(400)
    expect((await report('?lists=,,')).status).toBe(400)
    expect((await report('?min=abc')).status).toBe(400)
    expect((await report('?min=-1')).status).toBe(400)
  })

  test('404s an unknown list reference', async () => {
    expect((await report('?lists=collection:no-such-list')).status).toBe(404)
  })

  test('lists override type, and the report scopes to exactly those lists', async () => {
    const response = await report('?type=wanted&lists=collection:shoebox')
    expect(response.status).toBe(200)
    const body = (await response.json()) as SellReportResponse
    expect(body.lists.map((list) => `${list.type}:${list.name}`)).toEqual(['collection:shoebox'])
    expect(body.totals.totalValue).toBe(4)
  })

  test('503s when the card cache is empty', async () => {
    await cardCache.clear()
    expect((await report('')).status).toBe(503)
  })

  test('the cart endpoint shares the query contract and renders the CSV', async () => {
    expect(
      (await handleSellCart(new Request('http://localhost/api/sell/cart?min=abc'))).status,
    ).toBe(400)
    const response = await handleSellCart(new Request('http://localhost/api/sell/cart'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { csv: string; titleCount: number }
    expect(body.csv).toBe('card name,edition,foil,quantity\nSol Ring,Alpha,false,1\n')
    expect(body.titleCount).toBe(1)
  })
})
