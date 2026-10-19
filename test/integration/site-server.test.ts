import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { cardCache } from '../../src/cache'
import { startSiteServer } from '../../src/serve/server'
import { serveStaticSite, type StaticSiteServer } from '../../src/serve/static'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import type { DeckDetail, SiteIndex } from '../../src/list/site-data'
import {
  MAX_PRICE_BODY_BYTES,
  MAX_PRICE_NAMES,
  type CardPricesResponse,
} from '../../src/api/card-prices'
import type { CardsResponse } from '../../src/api/cards'
import type { BuylistQuotesResponse, BuylistStatusResponse } from '../../src/buylist'
import { saveCardKingdomCache, invalidateCardKingdomIndex } from '../../src/cardkingdom'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../test-utils'
import { getRitualConfigPath } from '../../src/config/ritual-config'
import { MAX_BUYLIST_PRINTINGS } from '../../src/api/buylist'
import { CARD_LANGUAGES } from '../../src/card/card-language'
import type { ScryfallCard } from '../../src/scryfall/types'
import type { ApiErrorResponse, ErrorFieldBody } from '../../src/api/http'
import type { CardPrintingsResponse } from '../../src/api/card-printings'
import { keyedMessage } from '../helpers/api-message'
import { pseudoCatalog, pseudoString, withGuardedLocaleAsync } from '../helpers/sync-text'

/**
 * Wiring pins for the hosted public-site server (`serve --api`): live JSON at
 * the static paths, unauthenticated cache-backed card queries, CORS for split
 * deployments, ETag revalidation, and the read-only guarantee. Engine
 * semantics (memoization, detail shapes, term matching) are pinned at the
 * unit layer (test/unit/serve/, test/unit/site-build/details.test.ts,
 * test/integration/card-search-api.test.ts).
 */
describe('site server (Integration)', () => {
  let ws: BoundWorkspace
  let server: StaticSiteServer
  let base: string

  beforeAll(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    createSyntheticWorkspace(ws.dir)
    // A minimal dist/ stands in for a real build: the server only needs files
    // to serve statically.
    const distDir = path.join(ws.dir, 'dist')
    await fs.mkdir(distDir, { recursive: true })
    await fs.writeFile(path.join(distDir, 'index.html'), '<!DOCTYPE html><title>Ritual</title>')
    await fs.writeFile(path.join(distDir, 'app.js'), '// app')
    cardCache.invalidate()
    // Term-separation fixture alongside the seeded synthetic cards.
    await cardCache.set('In the Trenches', [])
    await cardCache.set('Intrepid Paleontologist', [])
    server = startSiteServer({ port: 0, hostname: '127.0.0.1', distDir })
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.stop(true)
    await ws.dispose()
    cardCache.invalidate()
  })

  test('serves a live index with the same-origin marker, and disk edits appear without a rebuild', async () => {
    const first = await fetch(`${base}/index.json`)
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('no-cache')
    const index = (await first.json()) as SiteIndex
    expect(index.apiBaseUrl).toBe('')
    const emberwild = index.decks.find((d) => d.slug === 'emberwild-aggro')
    expect(emberwild).toBeDefined()

    // The headline behavior: edit the markdown on disk, refetch, no rebuild.
    const deckPath = path.join(ws.dir, 'decks', 'emberwild-aggro.md')
    const content = await fs.readFile(deckPath, 'utf-8')
    await Bun.sleep(5)
    await fs.writeFile(deckPath, content.replace('3 Lightning Bolt', '4 Lightning Bolt'))

    const second = await fetch(`${base}/decks/emberwild-aggro.json`)
    expect(second.status).toBe(200)
    const detail = (await second.json()) as DeckDetail
    const main = detail.deck.sections.find((s) => s.name === 'Main')
    expect(main?.cards.find((c) => c.name === 'Lightning Bolt')?.quantity).toBe(4)
  })

  test('serves each list type at its static path and 404s unknown slugs', async () => {
    for (const detailPath of [
      '/decks/emberwild-aggro.json',
      '/collections/test-binder.json',
      '/wanted/test-wants.json',
    ]) {
      const resp = await fetch(`${base}${detailPath}`)
      expect(resp.status).toBe(200)
      expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('*')
    }
    expect((await fetch(`${base}/decks/no-such-deck.json`)).status).toBe(404)
    expect((await fetch(`${base}/decks/not-json.txt`)).status).toBe(404)
  })

  test('ETag revalidation: 304 on If-None-Match, fresh 200 after a file change', async () => {
    const first = await fetch(`${base}/wanted/test-wants.json`)
    const etag = first.headers.get('ETag')
    expect(etag).toBeTruthy()

    const revalidated = await fetch(`${base}/wanted/test-wants.json`, {
      headers: { 'If-None-Match': etag! },
    })
    expect(revalidated.status).toBe(304)

    const wantedPath = path.join(ws.dir, 'wanted', 'test-wants.md')
    const content = await fs.readFile(wantedPath, 'utf-8')
    await Bun.sleep(5)
    await fs.writeFile(wantedPath, `${content}- Serra Angel &99\n`)

    const fresh = await fetch(`${base}/wanted/test-wants.json`, {
      headers: { 'If-None-Match': etag! },
    })
    expect(fresh.status).toBe(200)
    expect(fresh.headers.get('ETag')).not.toBe(etag)
  })

  test('autocomplete is unauthenticated and term-separated', async () => {
    const resp = await fetch(`${base}/api/autocomplete?q=${encodeURIComponent('in tre')}`)
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as { success: boolean; names: string[] }
    expect(body.success).toBeTrue()
    expect(body.names[0]).toBe('In the Trenches')
  })

  test('card-printings serves cached printings without auth', async () => {
    const resp = await fetch(
      `${base}/api/card-printings?name=${encodeURIComponent('Lightning Bolt')}`,
    )
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as { success: boolean; printings: ScryfallCard[] }
    expect(body.success).toBeTrue()
    expect(body.printings.length).toBeGreaterThan(0)
  })

  test('cards resolves Scryfall IDs from the cache and validates the ids param', async () => {
    const printings = (await cardCache.get('Lightning Bolt')) ?? []
    const id = printings[0]?.id
    expect(id).toBeString()

    const resp = await fetch(`${base}/api/cards?ids=${encodeURIComponent(id!)},not-a-real-id`)
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as CardsResponse
    expect(body.success).toBeTrue()
    // The unknown id is dropped rather than failing the whole lookup.
    expect(body.cards.map((c) => c.id)).toEqual([id!])

    // One representative rejection; the parser's cases are pinned in
    // test/unit/api/cards.test.ts.
    expect((await fetch(`${base}/api/cards`)).status).toBe(400)
  })

  test('batch card-prices returns cached printings', async () => {
    const resp = await fetch(`${base}/api/card-prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: ['Lightning Bolt'] }),
    })
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as CardPricesResponse
    expect(body.success).toBeTrue()
    expect(body.cards.some((c) => c.name === 'Lightning Bolt')).toBeTrue()
  })

  // The server runs in this process, so the pseudo-locale is the server's own
  // UI language: every refusal still reaches a client in English with its key,
  // the field it names an untranslated param. The shapes are pinned at the unit
  // layer (test/unit/api/); this pins what the hosted transport carries.
  test('refusals answer in English with their keys under a foreign UI language', async () => {
    const postPrices = (body: string): Promise<Response> =>
      fetch(`${base}/api/card-prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    const [names, tooMany, notJson, notObject, tooLarge, limit, art, unknownApi, unknownDeck] =
      await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
        Promise.all([
          postPrices(JSON.stringify({ names: 'Lightning Bolt' })),
          postPrices(
            JSON.stringify({ names: Array.from({ length: MAX_PRICE_NAMES + 1 }, () => 'x') }),
          ),
          postPrices('{"names": '),
          postPrices('[1]'),
          postPrices(JSON.stringify({ names: ['x'.repeat(MAX_PRICE_BODY_BYTES)] })),
          fetch(`${base}/api/card-printings?name=Sol%20Ring&limit=%20abc%20`),
          fetch(`${base}/art/nope.png`),
          fetch(`${base}/api/no-such-route`),
          fetch(`${base}/decks/no-such-deck.json`),
        ]),
      )

    expect(names.status).toBe(400)
    const namesBody = (await names.json()) as ApiErrorResponse
    expect(keyedMessage(namesBody)).toBe('"names" must be an array of strings.')
    expect(namesBody).toMatchObject({
      messageKey: 'admin.api.field.notStringArray',
      messageParams: { field: 'names' },
    })

    expect(tooMany.status).toBe(400)
    const tooManyBody = (await tooMany.json()) as ApiErrorResponse
    expect(keyedMessage(tooManyBody)).toBe(
      `"names" must contain at most ${MAX_PRICE_NAMES} entries.`,
    )
    expect(tooManyBody).toMatchObject({
      messageKey: 'admin.api.field.tooMany',
      messageParams: { field: 'names', count: MAX_PRICE_NAMES },
    })

    expect(notJson.status).toBe(400)
    const notJsonBody = (await notJson.json()) as ApiErrorResponse
    expect(keyedMessage(notJsonBody)).toBe('Request body must be JSON.')
    expect(notJsonBody.messageKey).toBe('admin.api.body.notJson')

    expect(notObject.status).toBe(400)
    const notObjectBody = (await notObject.json()) as ApiErrorResponse
    expect(keyedMessage(notObjectBody)).toBe('Request body must be a JSON object.')
    expect(notObjectBody.messageKey).toBe('admin.api.body.notObject')

    expect(tooLarge.status).toBe(413)
    const tooLargeBody = (await tooLarge.json()) as ApiErrorResponse
    expect(keyedMessage(tooLargeBody)).toBe(
      `Request body too large (limit ${MAX_PRICE_BODY_BYTES} bytes)`,
    )
    expect(tooLargeBody).toMatchObject({
      messageKey: 'admin.api.body.tooLarge',
      messageParams: { count: MAX_PRICE_BODY_BYTES },
    })

    expect(limit.status).toBe(400)
    const limitBody = (await limit.json()) as CardPrintingsResponse
    if (limitBody.success) throw new Error('expected a refusal')
    expect(limitBody.printings).toEqual([])
    expect(keyedMessage(limitBody)).toBe('Invalid "limit" \'abc\'. Use a positive integer.')
    // The value as the rule judged it: trimmed.
    expect(limitBody).toMatchObject({
      messageKey: 'admin.api.field.notPositiveInteger',
      messageParams: { field: 'limit', value: 'abc' },
    })

    // Every site-server 404 is one shape: the English under `error`, its key
    // beside it as `errorKey`.
    for (const missing of [art, unknownApi, unknownDeck]) {
      expect(missing.status).toBe(404)
      expect((await missing.json()) as ErrorFieldBody).toEqual({
        error: 'Not found',
        errorKey: 'admin.api.server.notFound',
      })
    }
  })

  test('CORS: preflight 204 on known routes, wildcard origin on responses', async () => {
    const preflight = await fetch(`${base}/api/autocomplete`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('POST')

    const data = await fetch(`${base}/index.json`)
    expect(data.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('read-only: admin mutation routes do not exist here', async () => {
    expect((await fetch(`${base}/api/deck/create`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${base}/api/config`, { method: 'PUT' })).status).toBe(404)
    expect((await fetch(`${base}/api/deck/emberwild-aggro`, { method: 'DELETE' })).status).toBe(404)
  })

  describe('custom art route', () => {
    beforeAll(async () => {
      // The workspace's configured art directory (`artDir`, default ./art).
      await fs.mkdir(path.join(ws.dir, 'art', 'proxies'), { recursive: true })
      await fs.writeFile(path.join(ws.dir, 'art', 'proxies', 'sol ring.png'), 'ring-bytes')
      await fs.writeFile(path.join(ws.dir, 'art', 'notes.txt'), 'not an image')
      // A real image one level *above* the art directory, with an extension the
      // route serves: the target a traversal would reach if the guard were
      // gone. Without it, a `..` request 404s on the extension gate or on the
      // file simply not being there, and the assertion below would hold for a
      // route that has no guard at all.
      await fs.writeFile(path.join(ws.dir, 'outside.png'), 'outside-bytes')
    })

    test('serves a nested art file at the path a built site carries it at', async () => {
      const response = await fetch(`${base}/art/proxies/sol%20ring.png`)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/png')
      expect(await response.text()).toBe('ring-bytes')
    })

    test('404s a missing file and a non-image extension', async () => {
      expect((await fetch(`${base}/art/nope.png`)).status).toBe(404)
      expect((await fetch(`${base}/art/notes.txt`)).status).toBe(404)
    })

    test('404s a traversal to a real image outside the art directory', async () => {
      for (const suffix of [
        '..%2Foutside.png',
        '..%5Coutside.png',
        'proxies/..%2F..%2Foutside.png',
      ]) {
        const response = await fetch(`${base}/art/${suffix}`)
        expect(response.status).toBe(404)
        expect(await response.text()).not.toContain('outside-bytes')
      }
    })
  })

  test('static assets and SPA fallback still work; unknown /api/* is JSON 404, not SPA', async () => {
    const html = await fetch(`${base}/`)
    expect(html.status).toBe(200)
    expect(await html.text()).toContain('Ritual')

    const asset = await fetch(`${base}/app.js`)
    expect(asset.status).toBe(200)

    const unknownApi = await fetch(`${base}/api/nope`)
    expect(unknownApi.status).toBe(404)
    expect(unknownApi.headers.get('Content-Type')).toContain('application/json')
  })

  describe('buylist routes (sell mode)', () => {
    const quoteBody = (printings: unknown[]): RequestInit => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printings }),
    })
    const emberwild = { set: 'tst', collectorNumber: '1', finish: 'nonfoil' }

    /** Rewrite the workspace config with sell mode set to `enabled`. */
    async function setSellMode(enabled: boolean): Promise<void> {
      const raw = JSON.parse(await fs.readFile(getRitualConfigPath(), 'utf-8')) as Record<
        string,
        unknown
      >
      const site = (raw['site'] ?? {}) as Record<string, unknown>
      await fs.writeFile(
        getRitualConfigPath(),
        JSON.stringify({ ...raw, site: { ...site, sellMode: enabled } }),
      )
    }

    beforeAll(async () => {
      // Sell mode is off unless a workspace asks for it, so these routes only
      // exist because this config says so.
      await setSellMode(true)
      await saveCardKingdomCache(
        makeCardKingdomCacheFile([
          makeCardKingdomProduct({
            id: 900,
            sku: 'TST-0001',
            scryfallId: 'e2e00000-0000-4000-8000-000000000008',
            name: 'Emberwild Phoenix',
            edition: 'Test Set',
            priceBuy: 2.25,
            qtyBuying: 4,
          }),
        ]),
      )
      invalidateCardKingdomIndex()
    })

    test('quotes a printing and omits ones the buyer has no product for', async () => {
      const response = await fetch(
        `${base}/api/buylist/quotes`,
        quoteBody([emberwild, { set: 'tst', collectorNumber: '999', finish: 'nonfoil' }]),
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as BuylistQuotesResponse
      expect(body.buyer).toBe('cardkingdom')
      expect(body.quotes['tst:1:nonfoil']).toMatchObject({ priceBuy: 2.25, buying: true })
      // Sparse: an unquoted printing is absent, not a zero-priced entry.
      expect(body.quotes['tst:999:nonfoil']).toBeUndefined()
    })

    test('reports feed freshness without quoting anything', async () => {
      const response = await fetch(`${base}/api/buylist/status`)
      expect(response.status).toBe(200)
      const body = (await response.json()) as BuylistStatusResponse
      expect(body).toMatchObject({ buyer: 'cardkingdom', buyers: ['cardkingdom'], stale: false })
      expect(body.productCount).toBe(1)
    })

    test('answers CORS so a CDN-hosted build can reach it', async () => {
      const response = await fetch(`${base}/api/buylist/quotes`, quoteBody([emberwild]))
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    test('refuses a malformed body and an oversized batch', async () => {
      const bad = await fetch(`${base}/api/buylist/quotes`, quoteBody([{ set: 'tst' }]))
      expect(bad.status).toBe(400)

      const tooMany = await fetch(
        `${base}/api/buylist/quotes`,
        quoteBody(Array.from({ length: MAX_BUYLIST_PRINTINGS + 1 }, () => emberwild)),
      )
      expect(tooMany.status).toBe(400)
    })

    // The quote parser's rules are pinned at the unit layer; this pins that the
    // hosted route carries its refusals as English plus the key, the params
    // (a nested `unit` list of language codes included) intact.
    test('refuses a bad finish and language in English with their keys', async () => {
      const [finish, language] = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
        Promise.all([
          fetch(`${base}/api/buylist/quotes`, quoteBody([{ ...emberwild, finish: 'shiny' }])),
          fetch(`${base}/api/buylist/quotes`, quoteBody([{ ...emberwild, language: 'xx' }])),
        ]),
      )

      expect(finish.status).toBe(400)
      const finishBody = (await finish.json()) as ApiErrorResponse
      expect(keyedMessage(finishBody)).toBe(
        "Invalid printings[0].finish 'shiny'. Use one of: nonfoil, foil, etched.",
      )
      expect(finishBody).toMatchObject({
        messageKey: 'errors.enum.invalid',
        messageParams: {
          field: 'printings[0].finish',
          value: 'shiny',
          choices: 'nonfoil, foil, etched',
        },
      })

      expect(language.status).toBe(400)
      const languageBody = (await language.json()) as ApiErrorResponse
      expect(languageBody.messageKey).toBe('domain.card.language.invalidField')
      expect(languageBody.messageParams).toEqual({
        value: '"xx"',
        field: 'printings[0].language',
        languages: { list: [...CARD_LANGUAGES], join: 'unit' },
      })
      expect(keyedMessage(languageBody)).toStartWith(
        'Invalid language "xx" for "printings[0].language".',
      )
    })

    test('exposes no public refresh route — the feed is never downloadable from here', async () => {
      const response = await fetch(`${base}/api/sell/refresh`, { method: 'POST' })
      expect(response.status).toBe(404)
    })

    test('404s both routes when site.sellMode is off, without a restart', async () => {
      // The route table is built once at startup, so the gate must read config
      // per request — a `config set` has to take effect on a running server.
      await setSellMode(false)
      try {
        expect((await fetch(`${base}/api/buylist/status`)).status).toBe(404)
        expect((await fetch(`${base}/api/buylist/quotes`, quoteBody([emberwild]))).status).toBe(404)
      } finally {
        await setSellMode(true)
      }
      expect((await fetch(`${base}/api/buylist/status`)).status).toBe(200)
    })
  })
})

describe('static site server (Integration)', () => {
  test('a path with no file and no app shell is a plain-text 404 in the server’s UI language', async () => {
    // A page a person reads in a browser, not a reply a client parses — so it
    // follows the operator's UI language, unlike the JSON 404s above.
    const ws = await bindWorkspace({ dirs: [], config: false })
    const server = serveStaticSite({
      distDir: path.join(ws.dir, 'empty'),
      port: 0,
      hostname: '127.0.0.1',
    })
    try {
      const res = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), async () => {
        const response = await fetch(`http://127.0.0.1:${server.port}/nope`)
        return { status: response.status, body: await response.text() }
      })
      expect(res).toEqual({ status: 404, body: pseudoString('cli.serve.pageNotFound') })
    } finally {
      await server.stop(true)
      await ws.dispose()
    }
  })
})
