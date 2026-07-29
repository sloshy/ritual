/**
 * `POST /api/cache/refresh` — the route's own contract, not the ingest's.
 *
 * Two things changed with the engine's real progress seam and are pinned here:
 * the route reports a monotonic 0–100 scale to an in-process caller (the MCP
 * `refresh_cache` tool's channel), and a failed refresh now reaches the caller
 * as a non-2xx instead of being swallowed into `success: true`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleCacheRefresh, type CacheRefreshResponse } from '../../src/admin/api/cache'
import { cardCache } from '../../src/cache'
import type { RouteProgress } from '../../src/progress'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
import { stubScryfallBulk } from './helpers/scryfall-bulk'
import type { StubbedFetch } from './helpers/stub-fetch'
import { bulkCard, expectMonotonicProgress } from '../test-utils'

let ws: BoundWorkspace
let stubbed: StubbedFetch | undefined

beforeEach(async () => {
  ws = await bindWorkspace({ clearCardCache: true })
})

afterEach(async () => {
  stubbed?.restore()
  stubbed = undefined
  await ws.dispose()
})

describe('handleCacheRefresh', () => {
  test('reports a monotonic 0–100 scale and refreshes the cache', async () => {
    stubbed = stubScryfallBulk({ cards: [bulkCard()] })

    const reports: RouteProgress[] = []
    const resp = await handleCacheRefresh((report) => reports.push(report))

    expect(resp.status).toBe(200)
    expect(((await resp.json()) as CacheRefreshResponse).message).toBe(
      'Cache refreshed successfully',
    )
    expect(await cardCache.get('Sol Ring')).not.toBeNull()

    expectMonotonicProgress(reports, 100)
    expect(reports[0]?.progress).toBe(1)
    expect(reports.at(-1)?.progress).toBe(100)
  })

  test('a failed download is reported instead of being swallowed as success', async () => {
    stubbed = stubScryfallBulk({ cardBulk: () => new Response('nope', { status: 500 }) })

    const resp = await handleCacheRefresh()

    expect(resp.status).toBe(500)
    expect(((await resp.json()) as { success: boolean }).success).toBe(false)
  })
})
