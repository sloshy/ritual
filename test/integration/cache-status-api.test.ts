import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleCacheStatus, type CacheStatusResponse } from '../../src/admin/api/cache'
import { cardCache } from '../../src/cache'
import { clearCacheServerAddressOverride } from '../../src/cache/config'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
import { makeScryfallCard } from '../test-utils'

/**
 * `GET /api/cache/status` — the admin route over the same collector
 * `ritual cache status` prints. The report's semantics are covered by the CLI
 * suite (`cache-status.test.ts`); this pins the route's wiring: the success
 * envelope, and that asking never mutates the cache.
 */

let workspace: BoundWorkspace
const originalCacheServer = process.env.RITUAL_CACHE_SERVER

beforeEach(async () => {
  // `source` is derived from the configured cache server, so a host (or a
  // neighbouring test) that set one would otherwise flip it to 'cache-server'.
  delete process.env.RITUAL_CACHE_SERVER
  clearCacheServerAddressOverride()
  workspace = await bindWorkspace({ clearCardCache: true })
})

afterEach(async () => {
  await workspace.dispose()
  if (originalCacheServer === undefined) delete process.env.RITUAL_CACHE_SERVER
  else process.env.RITUAL_CACHE_SERVER = originalCacheServer
})

async function status(): Promise<CacheStatusResponse> {
  const resp = await handleCacheStatus()
  expect(resp.status).toBe(200)
  return (await resp.json()) as CacheStatusResponse
}

describe('handleCacheStatus', () => {
  test('the route wraps the collector report in the success envelope', async () => {
    expect(await status()).toEqual({
      success: true,
      empty: true,
      cardCount: 0,
      lastCardRefresh: null,
      priceAgeHours: null,
      priceStale: true,
      tagsPresent: false,
      source: 'local',
    })
  })

  test('asking for the status leaves the cache untouched', async () => {
    await cardCache.bulkSet({ 'Sol Ring': [makeScryfallCard({ name: 'Sol Ring' })] })
    const before = await cardCache.getLastRefreshedAt()

    expect(await status()).toMatchObject({ success: true, empty: false, cardCount: 1 })

    expect(await cardCache.keys()).toEqual(['Sol Ring'])
    expect(await cardCache.getLastRefreshedAt()).toBe(before)
  })
})
