/**
 * The buylist routes' text, whatever language the server process runs in.
 *
 * `POST /api/sell/refresh` and `GET /api/buylist/status` answer the admin site
 * and the MCP tools, so every refusal and warning they carry is English plus
 * its key — the admin re-renders the key in its reader's language, an agent
 * reads the English. Run under the full pseudo-locale, where every catalog
 * message changes, so a sentence rendered in the process's language could not
 * pass for English. (German is not a leg here: these bodies carry no `Intl`
 * figure, so it would compare English with English.) The rendering itself is
 * pinned in test/unit/cardkingdom-ensure.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleSellRefresh, type SellRefreshResponse } from '../../src/admin/api/sell'
import { handleBuylistStatus } from '../../src/api/buylist'
import { CARDKINGDOM_PRICELIST_URL, invalidateCardKingdomIndex } from '../../src/cardkingdom'
import { BUYLIST_FEED_MAX_AGE_MS } from '../../src/buylist'
import type { ApiErrorResponse } from '../../src/api/http'
import type { SyncMessage } from '../../src/sync/message'
import { keyedMessage } from '../helpers/api-message'
import { pseudoCatalog, withGuardedLocaleAsync } from '../helpers/sync-text'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import {
  cardKingdomFeedBody,
  makeCardKingdomCacheFile,
  makeCardKingdomProduct,
} from '../test-utils'
import { MemoryLogger, resetLogger, setLogger } from '../../src/util/logger'

let ws: BoundWorkspace
let stubbed: StubbedFetch | undefined

beforeEach(async () => {
  ws = await bindWorkspace()
  invalidateCardKingdomIndex()
  // The refresh logs its progress and its fallback; keep the run quiet.
  setLogger(new MemoryLogger())
  // Card Kingdom is down: every download fails with a 503.
  stubbed = stubFetch({
    [CARDKINGDOM_PRICELIST_URL]: () => new Response('unavailable', { status: 503 }),
  })
})

afterEach(async () => {
  stubbed?.restore()
  stubbed = undefined
  resetLogger()
  invalidateCardKingdomIndex()
  await ws.dispose()
})

/** The failure every download in this suite ends in, as the routes carry it. */
const DOWNLOAD_FAILED: SyncMessage = {
  message: 'Card Kingdom feed download failed: HTTP 503',
  messageKey: 'domain.cache.cardKingdom.downloadHttpFailed',
  messageParams: { status: 503 },
}

const PSEUDO = 'en-XA'

/** POST /api/sell/refresh, in-process. */
function refresh(): Promise<Response> {
  return handleSellRefresh(new Request('http://localhost/api/sell/refresh', { method: 'POST' }))
}

describe('buylist routes under a translated server (Integration)', () => {
  test('a failed first download answers 502 in English, keyed', async () => {
    const response = await withGuardedLocaleAsync(PSEUDO, pseudoCatalog(), () => refresh())

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ success: false, ...DOWNLOAD_FAILED })
  })

  test('a failed refresh of a stale feed keeps it, its warning English and keyed', async () => {
    const stale = makeCardKingdomCacheFile(
      [makeCardKingdomProduct()],
      Date.now() - 2 * BUYLIST_FEED_MAX_AGE_MS,
    )
    await fs.mkdir(path.join(ws.dir, 'cache'), { recursive: true })
    await fs.writeFile(path.join(ws.dir, 'cache', 'cardkingdom.json'), JSON.stringify(stale))

    const response = await withGuardedLocaleAsync(PSEUDO, pseudoCatalog(), () => refresh())

    expect(response.status).toBe(200)
    const body = (await response.json()) as SellRefreshResponse
    expect(body.refreshed).toBe(false)
    expect(body.feedRetrievedAt).toBe(stale.retrievedAt)
    expect(body.staleFallback).toEqual(DOWNLOAD_FAILED)
    expect(body.skippedRows).toEqual([])
  })

  test('a download that skipped rows reports each, English and keyed', async () => {
    stubbed?.restore()
    const feed = cardKingdomFeedBody()
    stubbed = stubFetch({
      [CARDKINGDOM_PRICELIST_URL]: () =>
        Response.json({ ...feed, data: [...(feed['data'] as unknown[]), { id: 9 }] }),
    })

    const response = await withGuardedLocaleAsync(PSEUDO, pseudoCatalog(), () => refresh())

    expect(response.status).toBe(200)
    const body = (await response.json()) as SellRefreshResponse
    expect(body.refreshed).toBe(true)
    expect(body.productCount).toBe(1)
    expect(body.staleFallback).toBeUndefined()
    expect(body.skippedRows).toEqual([
      {
        message: 'Skipped Card Kingdom product data[1]: missing string sku',
        messageKey: 'domain.cache.cardKingdom.feed.productSkipped',
        messageParams: {
          index: 1,
          reason: { messageKey: 'domain.cache.cardKingdom.product.noSku' },
        },
      },
    ])
  })

  test('a status read with no feed names every remedy in English, keyed', async () => {
    const response = await withGuardedLocaleAsync(PSEUDO, pseudoCatalog(), () =>
      handleBuylistStatus(new Request('http://localhost/api/buylist/status')),
    )

    expect(response.status).toBe(503)
    const body = (await response.json()) as ApiErrorResponse
    expect(body.messageKey).toBe('domain.cache.cardKingdom.missingApiAdvice')
    // The lead nests as a reference; the identifiers it names are plain params.
    expect(body.messageParams).toEqual({
      lead: { messageKey: 'domain.cache.cardKingdom.noFeed' },
      tool: 'refresh_buylist',
      route: 'POST /api/sell/refresh',
      command: 'ritual sell --refresh auto',
    })
    // The English agrees with its key, nested lead sentence included.
    expect(keyedMessage(body)).toBe(
      'No Card Kingdom buylist has been downloaded yet. Refresh the Card Kingdom buylist first: the refresh_buylist tool, POST /api/sell/refresh, or `ritual sell --refresh auto` on the CLI.',
    )
    expect(stubbed?.sent).toEqual([])
  })
})
