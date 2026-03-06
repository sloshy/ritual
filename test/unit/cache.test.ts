import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { FileCacheManager } from '../../src/cache/file-cache'
import { MemoryLogger, setLogger, resetLogger } from '../../src/logger'
import type { ScryfallCard } from '../../src/types'

function makeTempPath(): string {
  return path.join(os.tmpdir(), `ritual-test-cache-${Math.random().toString(36).slice(2)}.json`)
}

function makeCard(name: string): ScryfallCard {
  return {
    id: name,
    name,
    mana_cost: '',
    type_line: '',
    oracle_text: '',
    set: 'test',
    collector_number: '1',
    released_at: '2020-01-01',
    color_identity: [],
    prices: {},
  } as unknown as ScryfallCard
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

  test('isBlocked is case-insensitive (checks lowercase)', async () => {
    await cache.addToBlocklist('Sol Ring')
    expect(await cache.isBlocked('sol ring')).toBe(true)
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

  test('addToBlocklist stores lowercase name', async () => {
    await cache.addToBlocklist('NONEXISTENT CARD')
    expect(await cache.isBlocked('nonexistent card')).toBe(true)
  })

  test('blocklist expiry is one week from now', async () => {
    const before = Date.now()
    await cache.addToBlocklist('testcard')
    const after = Date.now()
    const raw = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as {
      cardBlocklist: Record<string, number>
    }
    const expiry = raw.cardBlocklist?.testcard ?? 0
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    expect(expiry).toBeGreaterThanOrEqual(before + WEEK_MS)
    expect(expiry).toBeLessThanOrEqual(after + WEEK_MS)
  })
})
