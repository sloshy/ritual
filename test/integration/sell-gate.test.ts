import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { dispatchRoute, type RequestContext } from '../../src/admin/server'
import { invalidateCardKingdomIndex, saveCardKingdomCache } from '../../src/cardkingdom'
import { clearSiteSellModeOverride, setSiteSellModeOverride } from '../../src/ritual-config'
import { bindWorkspace, writeConfig, type BoundWorkspace } from './helpers/workspace'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../test-utils'

/**
 * Sell mode gates the admin server's own sell surfaces, not just the public
 * one: a deployment that never turned it on does not advertise a capability it
 * has no feed behind. Dispatched through the route table (rather than by
 * calling handlers directly) because the gate lives in the table — which is
 * also the path `ritual mcp` takes, so its four sell tools are covered here too.
 *
 * The routes' own behavior is pinned elsewhere: quoting in
 * test/integration/site-server.test.ts, report/cart parameters in
 * test/unit/admin/sell.test.ts.
 */
describe('admin sell-mode gate (Integration)', () => {
  let workspace: BoundWorkspace

  /** One route to dispatch: its verb, its path, and a body when it takes one. */
  type GatedRoute = { method: string; path: string; body?: unknown }

  /** The one gated route with a request body, named so tests can dispatch it. */
  const QUOTES: GatedRoute = {
    method: 'POST',
    path: '/api/buylist/quotes',
    body: { printings: [{ set: 'tst', collectorNumber: '1', finish: 'nonfoil' }] },
  }

  /** Every gated route, with a body where the handler needs one. */
  const GATED: GatedRoute[] = [
    { method: 'GET', path: '/api/sell/report' },
    { method: 'GET', path: '/api/sell/cart' },
    { method: 'POST', path: '/api/sell/refresh' },
    { method: 'GET', path: '/api/buylist/status' },
    QUOTES,
  ]

  const context: RequestContext = { clientIp: '127.0.0.1', sessionToken: 'test-session' }

  async function dispatch(route: GatedRoute): Promise<Response | null> {
    const init: RequestInit = { method: route.method }
    if (route.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(route.body)
    }
    const result = await dispatchRoute(new Request(`http://admin${route.path}`, init), context)
    expect(result.matched).toBe(true)
    return result.matched ? result.response : null
  }

  beforeEach(async () => {
    workspace = await bindWorkspace({ init: true })
    await saveCardKingdomCache(
      makeCardKingdomCacheFile([
        makeCardKingdomProduct({ id: 1, sku: 'TST-0001', scryfallId: 'sf-1', priceBuy: 2 }),
      ]),
    )
    invalidateCardKingdomIndex()
  })

  afterEach(async () => {
    clearSiteSellModeOverride()
    invalidateCardKingdomIndex()
    await workspace.dispose()
  })

  test('every sell route 404s on a workspace that never enabled sell mode', async () => {
    for (const route of GATED) {
      const response = await dispatch(route)
      // A plain 404, the same answer an unknown path gets: a server without
      // sell mode does not disclose that the capability exists at all.
      expect(`${route.method} ${route.path} → ${response?.status}`).toBe(
        `${route.method} ${route.path} → 404`,
      )
      // The refresh route is the one that would spend ~70 MB; the gate must
      // stop it before the handler, not after. The body is the standard refusal
      // envelope every admin route answers with — a client branching on
      // `success === false` sees it, and the MCP dispatcher reads `message`
      // rather than degrading the tool error to "Admin request failed".
      expect(await response?.json()).toEqual({ success: false, message: 'Not found' })
    }
  })

  test('site.sellMode in the config opens the read routes', async () => {
    await writeConfig(workspace.dir, { site: { sellMode: true } })
    // The gate reads the config per request, so no restart and no rebind.
    const status = await dispatch({ method: 'GET', path: '/api/buylist/status' })

    expect(status?.status).toBe(200)
    expect(await status?.json()).toMatchObject({ buyer: 'cardkingdom', productCount: 1 })
  })

  test('the session override opens them too, which is how --sell-mode runs', async () => {
    setSiteSellModeOverride(true)

    const quotes = await dispatch(QUOTES)

    expect(quotes?.status).toBe(200)
    expect(await quotes?.json()).toMatchObject({ buyer: 'cardkingdom' })
  })

  /**
   * The capability flag every admin client boots from. It must answer the same
   * question the gate above does — a UI that keeps its sell surfaces against
   * routes that 404 is worse than either answer alone — so it is pinned here,
   * beside the gate, rather than only in an e2e that mocks the payload.
   */
  describe('GET /api/status sellMode', () => {
    async function statusSellMode(): Promise<boolean> {
      const response = await dispatch({ method: 'GET', path: '/api/status' })
      expect(response?.status).toBe(200)
      return ((await response?.json()) as { sellMode: boolean }).sellMode
    }

    test('is false on a workspace that never enabled it', async () => {
      expect(await statusSellMode()).toBe(false)
    })

    test('follows site.sellMode in the config, re-read per request', async () => {
      await writeConfig(workspace.dir, { site: { sellMode: true } })

      expect(await statusSellMode()).toBe(true)
    })

    test('reports the effective value, so --sell-mode shows through with no config', async () => {
      setSiteSellModeOverride(true)

      expect(await statusSellMode()).toBe(true)
    })
  })
})
