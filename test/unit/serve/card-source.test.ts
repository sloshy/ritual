import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getBaseDir, setBaseDir } from '../../../src/config/base-dir'
import { cardCache } from '../../../src/cache'
import { createCacheCardSource } from '../../../src/serve/card-source'
import { makeScryfallCard } from '../../../test/test-utils'
import type { PriceCurrency } from '../../../src/pricing/price-currency'

const CURRENCIES: PriceCurrency[] = ['usd', 'eur', 'tix']

// Priced close to the older printing so the representative pick (newest
// candidate within 1.5x the candidate median) keeps the newest printing.
const boltNew = makeScryfallCard({
  id: 'bolt-new',
  name: 'Lightning Bolt',
  set: 'm10',
  collector_number: '146',
  released_at: '2009-07-17',
  prices: { usd: '2.00', eur: '4.00' },
})
const boltOld = makeScryfallCard({
  id: 'bolt-old',
  name: 'Lightning Bolt',
  set: 'lea',
  collector_number: '161',
  released_at: '1993-08-05',
  prices: { usd: '1.00' },
})

describe('createCacheCardSource', () => {
  let dir: string
  let originalBase: string

  beforeEach(async () => {
    originalBase = getBaseDir()
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-card-source-'))
    setBaseDir(dir)
    cardCache.invalidate()
    await cardCache.clear()
  })

  afterEach(async () => {
    await cardCache.clear()
    setBaseDir(originalBase)
    cardCache.invalidate()
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('prefetches every name from the cache with no Scryfall fallback', async () => {
    await cardCache.set('Lightning Bolt', [boltOld, boltNew])
    const source = await createCacheCardSource(['Lightning Bolt', 'Unknown Card'], {
      currencies: CURRENCIES,
      bannedPrintings: new Set(),
    })

    // The display-printing rule itself is pinned in site-build/card-fetch.test.ts;
    // this layer only feeds it the cache's printings, with the first as the base.
    expect(source.cardData.printings['Lightning Bolt']).toHaveLength(2)
    expect(source.cardData.cards['Lightning Bolt']?.id).toBe('bolt-new')
    expect(source.cardData.cards['Unknown Card']).toBeNull()
    expect(source.cardData.printings['Unknown Card']).toEqual([])
    expect(source.cardData.missing.usd).toEqual(['Unknown Card'])
  })

  test('getPrintings memoizes and reads through the cache for unprefetched names', async () => {
    await cardCache.set('Lightning Bolt', [boltNew])
    const source = await createCacheCardSource(['Lightning Bolt'], {
      currencies: CURRENCIES,
      bannedPrintings: new Set(),
    })

    await cardCache.set('Late Card', [boltOld])
    expect(await source.getPrintings('Late Card')).toHaveLength(1)

    // Memoized: clearing the cache does not affect already-fetched names.
    await cardCache.clear()
    expect(await source.getPrintings('Late Card')).toHaveLength(1)
    expect(await source.getPrintings('Lightning Bolt')).toHaveLength(1)
    // A genuinely unknown name reads through and yields an empty array.
    expect(await source.getPrintings('Never Cached')).toEqual([])
  })
})
