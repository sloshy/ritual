import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { FileCacheManager } from '../../src/cache/file-cache'
import { MemoryLogger, setLogger, resetLogger } from '../../src/util/logger'
import { makeScryfallCard } from '../test-utils'
import type { PriceData } from '../../src/pricing/price-data'
import type { ScryfallCard } from '../../src/scryfall/types'

function makeTempPath(): string {
  return path.join(os.tmpdir(), `ritual-test-cache-${Math.random().toString(36).slice(2)}.json`)
}

function makeCard(name: string): ScryfallCard {
  return makeScryfallCard({ id: name, name })
}

describe('FileCacheManager - cardNameIndex', () => {
  let cachePath: string
  let cache: FileCacheManager<'cards'>
  let logger: MemoryLogger

  beforeEach(async () => {
    cachePath = makeTempPath()
    cache = new FileCacheManager(cachePath, 'cards', 0)
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(async () => {
    resetLogger()
    await fs.rm(cachePath, { force: true })
  })

  test('resolves canonical name after set()', async () => {
    await cache.set('Sol Ring', [makeCard('Sol Ring')])
    const canonical = await cache.resolveCardName('sol ring')
    expect(canonical).toBe('Sol Ring')
  })

  test('resolves canonical name after bulkSet()', async () => {
    await cache.bulkSet({
      'Winota, Joiner of Forces': [makeCard('Winota, Joiner of Forces')],
      'Lightning Bolt': [makeCard('Lightning Bolt')],
    })
    expect(await cache.resolveCardName('winota, joiner of forces')).toBe('Winota, Joiner of Forces')
    expect(await cache.resolveCardName('lightning bolt')).toBe('Lightning Bolt')
  })

  test('returns null for unknown lowercase name', async () => {
    const result = await cache.resolveCardName('unknown card')
    expect(result).toBeNull()
  })

  test('cached item has lowercaseName field set', async () => {
    await cache.set('Path to Exile', [makeCard('Path to Exile')])
    const raw = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as {
      cards: Record<string, { lowercaseName: string }>
    }
    expect(raw.cards['Path to Exile']?.lowercaseName).toBe('path to exile')
  })

  test('cardNameIndex is persisted to disk', async () => {
    await cache.set('Counterspell', [makeCard('Counterspell')])
    const raw = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as {
      cardNameIndex: Record<string, string>
    }
    expect(raw.cardNameIndex?.counterspell).toBe('Counterspell')
  })
})

describe('FileCacheManager - cardBlocklist', () => {
  let cachePath: string
  let cache: FileCacheManager<'cards'>
  let logger: MemoryLogger

  beforeEach(() => {
    cachePath = makeTempPath()
    cache = new FileCacheManager(cachePath, 'cards', 0)
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(async () => {
    resetLogger()
    await fs.rm(cachePath, { force: true })
  })

  test('addToBlocklist blocks the card and logs', async () => {
    await cache.addToBlocklist('Dark Ritual')
    expect(await cache.isBlocked('dark ritual')).toBe(true)
    expect(logger.entries.some((e) => e.args.join('').includes('dark ritual'))).toBe(true)
  })

  test('card not in blocklist returns false', async () => {
    expect(await cache.isBlocked('nonexistent card')).toBe(false)
  })

  test('purgeExpiredBlocklist removes expired entries and logs', async () => {
    await fs.writeFile(
      cachePath,
      JSON.stringify({
        prices: {},
        cards: {},
        cardBlocklist: {
          'expired card': Date.now() - 1000,
          'valid card': Date.now() + 999999,
        },
      }),
    )
    cache = new FileCacheManager(cachePath, 'cards', 0)
    await cache.purgeExpiredBlocklist()
    expect(await cache.isBlocked('expired card')).toBe(false)
    expect(await cache.isBlocked('valid card')).toBe(true)
    expect(logger.entries.some((e) => e.args.join('').includes('expired card'))).toBe(true)
  })

  test('purgeExpiredBlocklist does nothing if no blocklist', async () => {
    await cache.purgeExpiredBlocklist()
    // No error thrown
    expect(await cache.isBlocked('any')).toBe(false)
  })

  test('blocklist persists across cache instances', async () => {
    await cache.addToBlocklist('testcard')

    const reloaded = new FileCacheManager(cachePath, 'cards', 0)
    expect(await reloaded.isBlocked('testcard')).toBe(true)
    expect(await reloaded.isBlocked('unblocked card')).toBe(false)
  })
})

describe('FileCacheManager - disk persistence and expiry', () => {
  let cachePath: string
  let cacheManager: FileCacheManager<'prices'>

  beforeEach(() => {
    cachePath = makeTempPath()
    cacheManager = new FileCacheManager(cachePath, 'prices')
  })

  afterEach(async () => {
    await fs.rm(cachePath, { force: true })
  })

  test('should write to file and read back', async () => {
    const data: PriceData = { latest: 10, min: 1, max: 20 }

    await cacheManager.set('Test Card', data)

    // Verify file exists
    const fileExists = await fs
      .access(cachePath)
      .then(() => true)
      .catch(() => false)
    expect(fileExists).toBe(true)

    // Verify content
    const content = await fs.readFile(cachePath, 'utf-8')
    const json = JSON.parse(content) as { prices: Record<string, { data: PriceData }> }
    expect(json.prices['Test Card']?.data).toEqual(data)

    // Create new instance to ensure reading from disk
    const newManager = new FileCacheManager(cachePath, 'prices')
    const result = await newManager.get('Test Card')
    expect(result).toEqual(data)

    const timestamp = await newManager.getTimestamp('Test Card')
    expect(typeof timestamp).toBe('number')

    const lastRefreshedAt = await newManager.getLastRefreshedAt()
    expect(lastRefreshedAt).toBeNull()

    await newManager.bulkSet({
      'Bulk Card': { latest: 11, min: 2, max: 21 },
    })
    const refreshedAfterBulkSet = await newManager.getLastRefreshedAt()
    expect(typeof refreshedAfterBulkSet).toBe('number')
  })

  test('should expire items', async () => {
    // Inject a controllable clock so expiry is deterministic and does not
    // race real wall-clock timers under parallel test execution.
    let clockMs = 1_000
    const shortCache = new FileCacheManager(cachePath, 'prices', 10, () => clockMs) // 10ms TTL
    const data: PriceData = { latest: 100, min: 50, max: 150 }

    await shortCache.set('Expired Card', data)

    // Immediate read is within the TTL.
    expect(await shortCache.get('Expired Card')).toEqual(data)

    // Advance the clock past the TTL.
    clockMs += 20
    const result = await shortCache.get('Expired Card')
    expect(result).toBeNull()
  })
})
