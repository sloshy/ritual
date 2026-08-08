import { afterEach, describe, expect, test } from 'bun:test'
import type { StatusResponse } from '../../../src/admin/api/status'
import {
  refreshSellModeEnabled,
  sellModeEnabled,
  setSellModeEnabled,
} from '../../../src/admin/site/sell-enabled'
import { sellModeActive, setSellModeActive } from '../../../src/site/sell-mode'
import {
  quoteFor,
  requestBuylistQuotes,
  resetBuylistFetcher,
  resetBuylistQuotes,
} from '../../../src/site/buylist-quotes'
import { stubBuylistFetcher } from '../../test-utils'

/**
 * The admin SPA's sell-mode flag: primed at boot from `GET /api/status` and
 * re-asked after a Settings save, so ticking **Offer sell mode** reveals the
 * sell surfaces with no reload.
 *
 * Signal reads only — Solid effects do not run under `bun test` (solid-js
 * resolves to its server build), and the module store is the layer these rules
 * live at anyway. The consumers' reaction to the flag is a Playwright concern
 * (`test/e2e/admin/sell-mode-gate.spec.ts`).
 */

const realFetch = globalThis.fetch

/** Every URL `fetch` was called with since the last reset. */
let asked: string[] = []

/** A `GET /api/status` payload from a logged-in server offering (or not) sell mode. */
function status(sellMode: boolean): StatusResponse {
  return { ok: true, setupRequired: false, totpEnabled: false, sellMode }
}

/**
 * Answer every request with a fresh `makeResponse()`, recording the URL it was
 * asked for. Built per call because a `Response` body may only be read once.
 */
function stubFetch(makeResponse: () => Response): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    asked.push(input instanceof Request ? input.url : input.toString())
    return Promise.resolve(makeResponse())
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  asked = []
  setSellModeEnabled(false)
  setSellModeActive(false)
  resetBuylistQuotes()
  resetBuylistFetcher()
})

describe('setSellModeEnabled', () => {
  test('follows the effective value the server reported', () => {
    setSellModeEnabled(true)
    expect(sellModeEnabled()).toBe(true)

    setSellModeEnabled(false)
    expect(sellModeEnabled()).toBe(false)
  })

  test('turning the server capability off also turns the user’s mode and quotes off', async () => {
    setSellModeEnabled(true)
    setSellModeActive(true)
    stubBuylistFetcher(1.25)
    await requestBuylistQuotes([{ set: 'c21', collectorNumber: '263', finish: 'nonfoil' }])
    expect(quoteFor('c21', '263', 'nonfoil')).toBeDefined()

    setSellModeEnabled(false)

    // `buylistFieldsFor` and `cartBuyer` gate on the *user's* signal alone, so
    // leaving it on would keep buylist prices and the cart export on the next
    // page mount with no control anywhere to switch them off.
    expect(sellModeActive()).toBe(false)
    expect(quoteFor('c21', '263', 'nonfoil')).toBeUndefined()
  })

  test('a re-affirmed answer never clears the mode or the quotes', async () => {
    setSellModeEnabled(true)
    setSellModeActive(true)
    stubBuylistFetcher(1.25)
    await requestBuylistQuotes([{ set: 'c21', collectorNumber: '263', finish: 'nonfoil' }])

    // Every Settings save re-asks the server, so an unchanged `true` arrives
    // here routinely — wiping quotes a mounted page is showing on each save
    // would be the bug the on→off *edge* condition exists to prevent.
    setSellModeEnabled(true)
    expect(sellModeActive()).toBe(true)
    expect(quoteFor('c21', '263', 'nonfoil')).toBeDefined()

    // And once the mode is off, a re-affirmed `false` is not an edge either.
    setSellModeEnabled(false)
    setSellModeActive(true)
    setSellModeEnabled(false)
    expect(sellModeActive()).toBe(true)
  })
})

describe('refreshSellModeEnabled', () => {
  test('adopts the value a re-read of the status route reports', async () => {
    // The save path's whole point: the client asks the server rather than
    // trusting the config it just wrote, since only the server knows whether a
    // `--sell-mode` run is overriding the stored key.
    stubFetch(() => Response.json(status(true)))
    await refreshSellModeEnabled()

    expect(sellModeEnabled()).toBe(true)
    // Named explicitly: a refresh that read `/api/config` and derived the value
    // locally would satisfy every other assertion here.
    expect(asked).toEqual(['/api/status'])
  })

  test('leaves the flag alone when the status request fails', async () => {
    setSellModeEnabled(true)
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch

    await refreshSellModeEnabled()

    // Every sell surface on screen is consistent with the last answer the
    // server gave; hiding them on a transient network blip would be a worse
    // guess than the state already showing.
    expect(sellModeEnabled()).toBe(true)
  })

  test('leaves the flag alone when a JSON-bodied 500 answers the status route', async () => {
    setSellModeEnabled(true)
    // The admin's own envelope when `ritual.config.json` is unparseable: it
    // parses fine, so only the `resp.ok` check keeps it from reading as a
    // status payload with `sellMode` undefined.
    stubFetch(() => Response.json({ success: false, message: 'bad config' }, { status: 500 }))

    await refreshSellModeEnabled()

    expect(sellModeEnabled()).toBe(true)
  })

  test('leaves the flag alone when the payload is missing a field', async () => {
    setSellModeEnabled(true)
    // A 200 from a server ahead of or behind this bundle. Validated rather than
    // asserted into shape, so an absent `sellMode` is "no answer", not `false`.
    stubFetch(() => Response.json({ ok: true, setupRequired: false, totpEnabled: false }))

    await refreshSellModeEnabled()

    expect(sellModeEnabled()).toBe(true)
  })

  test('leaves the flag alone when the body is not JSON', async () => {
    setSellModeEnabled(true)
    // A reverse proxy's HTML error page.
    stubFetch(() => new Response('<html>502</html>', { headers: { 'Content-Type': 'text/html' } }))

    await refreshSellModeEnabled()

    expect(sellModeEnabled()).toBe(true)
  })
})
