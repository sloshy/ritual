import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/client'
import { cardCache } from '../../../src/cache'
import { setupMcpClient, type McpTestSession } from './harness'
import {
  cardKingdomFeedBody,
  makeCardKingdomCacheFile,
  makeCardKingdomProduct,
} from '../../test-utils'
import { expectSchemaRejection, toolData, toolError } from '../../mcp-test-utils'
import { clearSiteSellModeOverride, setSiteSellModeOverride } from '../../../src/ritual-config'

/**
 * Wiring-only coverage per the test layering policy: the tools are registered
 * with output schemas, their input schemas reject bad input, the query-string
 * translation reaches the handler, and the missing-feed refusal names the
 * remedy. Matching semantics are pinned in test/unit/sell-report.test.ts
 * against the engine; handler parameter validation in test/unit/admin/sell.test.ts.
 *
 * Every tool here reuses an admin route that `withBuylistFeedGate` 404s while sell
 * mode is off, so the suite turns it on the way `ritual mcp --sell-mode` does —
 * the temp workspace has no config file, and sell mode is off by default.
 */

/** Seed a collection holding the harness's cached Sol Ring plus a CK feed for it. */
async function seedSellFixture(session: McpTestSession): Promise<void> {
  const printings = (await cardCache.get('Sol Ring')) ?? []
  const printing = printings[0]!
  await fs.writeFile(
    path.join(session.env.dir, 'collections', 'shoebox.md'),
    `# Shoebox\n\n- Sol Ring (${printing.set.toUpperCase()}:${printing.collector_number}) &1\n`,
  )
  await fs.mkdir(path.join(session.env.dir, 'cache'), { recursive: true })
  await fs.writeFile(
    path.join(session.env.dir, 'cache', 'cardkingdom.json'),
    JSON.stringify(
      makeCardKingdomCacheFile([
        makeCardKingdomProduct({
          id: 10,
          sku: 'LEA-0231',
          scryfallId: printing.id,
          name: 'Sol Ring',
          edition: 'Alpha',
          priceBuy: 4,
          qtyBuying: 3,
        }),
      ]),
    ),
  )
}

describe('sell MCP tools', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('sell-tools-test')
    client = session.client
    setSiteSellModeOverride(true)
  })

  afterEach(async () => {
    clearSiteSellModeOverride()
    await session.close()
  })

  test('every sell tool is registered with an output schema', async () => {
    const { tools } = await client.listTools()
    for (const name of [
      'get_sell_report',
      'get_sell_cart',
      'get_buylist_quotes',
      'refresh_buylist',
    ]) {
      expect(tools.find((tool) => tool.name === name)?.outputSchema).toBeDefined()
    }
  })

  test('get_sell_report rejects a bad listType and a negative minPrice', async () => {
    expectSchemaRejection(
      await client.callTool({ name: 'get_sell_report', arguments: { listType: 'binder' } }),
      'listType',
    )
    expectSchemaRejection(
      await client.callTool({ name: 'get_sell_report', arguments: { minPrice: -1 } }),
      'minPrice',
    )
  })

  test('get_sell_report errors with the missing-feed remedy when no feed exists', async () => {
    const result = await client.callTool({ name: 'get_sell_report', arguments: {} })
    const error = toolError(result)
    expect(error.message).toContain('No Card Kingdom buylist has been downloaded yet')
    expect(error.message).toContain('refresh_buylist')
  })

  test('get_sell_report matches a seeded collection against a seeded feed', async () => {
    await seedSellFixture(session)
    // The lists + minPrice inputs pin the tool's query-string translation —
    // wiring that exists nowhere else — not the filtering semantics.
    const result = await client.callTool({
      name: 'get_sell_report',
      arguments: {
        lists: [{ listType: 'collection', slug: 'shoebox' }],
        minPrice: 1,
      },
    })
    const data = toolData<{
      entries: { name: string; status: string; priceBuy?: number }[]
      totals: { sellableCount: number; totalValue: number }
      filters: { minPrice?: number }
    }>(result)
    expect(data.filters.minPrice).toBe(1)
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0]).toMatchObject({ name: 'Sol Ring', status: 'buying', priceBuy: 4 })
    expect(data.totals.sellableCount).toBe(1)
    expect(data.totals.totalValue).toBe(4)
  })

  test('get_sell_cart renders the CK sell-cart CSV over the same scope', async () => {
    await seedSellFixture(session)
    const result = await client.callTool({ name: 'get_sell_cart', arguments: {} })
    const data = toolData<{ csv: string; titleCount: number; cardCount: number }>(result)
    expect(data.csv).toBe('Sol Ring,Alpha,false,1\n')
    expect(data.titleCount).toBe(1)
    expect(data.cardCount).toBe(1)
  })

  test('get_buylist_quotes rejects a malformed printing', async () => {
    expectSchemaRejection(
      await client.callTool({
        name: 'get_buylist_quotes',
        arguments: { printings: [{ set: 'lea', collectorNumber: '231', finish: 'shiny' }] },
      }),
      'finish',
    )
    expectSchemaRejection(
      await client.callTool({
        name: 'get_buylist_quotes',
        arguments: { printings: [], buyer: 'x' },
      }),
      'buyer',
    )
  })

  test('get_buylist_quotes answers per printing, omitting unquoted ones', async () => {
    await seedSellFixture(session)
    const printing = ((await cardCache.get('Sol Ring')) ?? [])[0]!
    const result = await client.callTool({
      name: 'get_buylist_quotes',
      arguments: {
        printings: [
          {
            set: printing.set,
            collectorNumber: printing.collector_number,
            finish: 'nonfoil',
            scryfallId: printing.id,
          },
          { set: 'lea', collectorNumber: '999', finish: 'nonfoil' },
        ],
      },
    })
    const data = toolData<{
      buyer: string
      quotes: Record<string, { priceBuy: number; buying: boolean }>
    }>(result)
    expect(data.buyer).toBe('cardkingdom')
    const key = `${printing.set.toLowerCase()}:${printing.collector_number}:nonfoil`
    expect(data.quotes[key]).toMatchObject({ priceBuy: 4, buying: true })
    expect(Object.keys(data.quotes)).toHaveLength(1)
  })

  test('refresh_buylist rejects a non-boolean force and surfaces download failures', async () => {
    expectSchemaRejection(
      await client.callTool({ name: 'refresh_buylist', arguments: { force: 'yes' } }),
      'force',
    )
    // The harness's offline Scryfall stub 404s every non-symbology URL, so the
    // CK download fails and the tool must report it as a structured error.
    const result = await client.callTool({ name: 'refresh_buylist', arguments: {} })
    const error = toolError(result)
    expect(error.message).toContain('Card Kingdom')
  })

  test('refresh_buylist reports a successful download', async () => {
    // Serve a one-product feed from the stubbed global fetch.
    const originalFetch = globalThis.fetch
    const stub = (input: string | URL | Request): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('api.cardkingdom.com')) {
        return Promise.resolve(Response.json(cardKingdomFeedBody()))
      }
      return originalFetch(input)
    }
    globalThis.fetch = stub as typeof fetch
    try {
      const result = await client.callTool({ name: 'refresh_buylist', arguments: {} })
      const data = toolData<{ refreshed: boolean; productCount: number; warnings: string[] }>(
        result,
      )
      expect(data.refreshed).toBe(true)
      expect(data.productCount).toBe(1)
      expect(data.warnings).toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('every sell tool is refused when sell mode is off', async () => {
    // Still listed — the tool set is fixed at build time — but the routes they
    // reuse are gated, so an agent on a default workspace gets the gate's 404
    // rather than a quote. `ritual mcp --sell-mode` (or `site.sellMode`) is the
    // remedy the tool descriptions name.
    await seedSellFixture(session)
    clearSiteSellModeOverride()

    const calls = [
      { name: 'get_sell_report', arguments: {} },
      { name: 'get_sell_cart', arguments: {} },
      { name: 'get_buylist_quotes', arguments: { printings: [] } },
      { name: 'refresh_buylist', arguments: {} },
    ]
    for (const call of calls) {
      // The gate answers the standard refusal envelope, so its `message`
      // survives the dispatcher instead of degrading to the meaningless
      // "Admin request failed (HTTP 404)".
      expect(toolError(await client.callTool(call)).message).toBe('Not found')
    }
  })
})
