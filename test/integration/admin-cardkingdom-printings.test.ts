import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../src/cache'
import { refreshRitualConfig, resetRitualConfigCache } from '../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import type { PriceSource } from '../../src/pricing/price-source'
import { invalidateCardKingdomIndex, saveCardKingdomCache } from '../../src/cardkingdom'
import { getCardKingdomCachePath } from '../../src/cardkingdom/cache'
import { loadDeckCardData, loadEntryCardData } from '../../src/admin/api/card-data-loader'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../test-utils'

/**
 * The admin editors' half of per-store printing picks: the shared card-data
 * loader ships Card Kingdom's own picks beside the Scryfall ones, so an editor
 * and a published page never disagree about which printing a name-only line is.
 *
 * The synthetic Sol Ring has two printings — C21 ($1.50, 2021) and LEA ($25.00,
 * 1993) — so Scryfall's recency-plus-median pick is the C21 one. This buyer
 * stocks **only** the LEA printing, which is what makes the CK pick observable:
 * it is a printing the Scryfall selection would never land on.
 *
 * The selection rule itself is pinned at the unit layer
 * (test/unit/cardkingdom-retail.test.ts); what is only observable here is that
 * the admin route's loader consults the feed at all, and honours `priceSources`.
 */
describe('admin card-data loader — Card Kingdom printings (Integration)', () => {
  let ws: BoundWorkspace

  /** Rewrite the workspace config, which is where `priceSources` is read from. */
  async function setPriceSources(sources: readonly PriceSource[]): Promise<void> {
    const configPath = path.join(ws.dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    config['priceSources'] = sources
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
    resetRitualConfigCache()
    await refreshRitualConfig()
  }

  beforeAll(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    createSyntheticWorkspace(ws.dir)
    await refreshRitualConfig()
    cardCache.invalidate()
    await saveCardKingdomCache(
      makeCardKingdomCacheFile(
        [
          makeCardKingdomProduct({
            id: 1,
            sku: 'LEA-0270',
            scryfallId: 'e2e00000-0000-4000-8000-000000000001',
            name: 'Sol Ring',
            edition: 'Limited Edition Alpha',
            finish: 'nonfoil',
            priceRetail: 40,
            qtyRetail: 2,
          }),
        ],
        Date.now(),
      ),
    )
    invalidateCardKingdomIndex()
  })

  afterAll(async () => {
    invalidateCardKingdomIndex()
    await ws.dispose()
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  beforeEach(() => {
    cardCache.invalidate()
  })

  test('a deck load carries CK picks beside the Scryfall ones', async () => {
    await setPriceSources(['tcgplayer', 'cardkingdom'])

    const result = await loadDeckCardData(new Set(['Sol Ring']))

    // Scryfall picks the recent C21 printing; CK sells only the LEA one.
    expect(result.cards['Sol Ring']?.set).toBe('c21')
    expect(result.cardsCardKingdom?.['Sol Ring']?.set).toBe('lea')
    expect(result.lowestPriceCards['Sol Ring']?.set).toBe('c21')
    expect(result.lowestPriceCardsCardKingdom?.['Sol Ring']?.set).toBe('lea')
  })

  test('a wanted load carries the CK pick under the card name; a collection load skips it', async () => {
    await setPriceSources(['tcgplayer', 'cardkingdom'])

    const wanted = await loadEntryCardData(new Set(['Sol Ring']), { cardKingdomPicks: true })
    expect(wanted.cardsCardKingdom?.['Sol Ring']?.set).toBe('lea')
    // The printing-keyed slots are untouched: a pinned line resolves through
    // them and must show the printing it names under either store.
    expect(wanted.cards['c21:263']?.set).toBe('c21')

    // A collection's every entry names its printing, so the selection is not
    // run at all — the option is what the collection route passes.
    const collection = await loadEntryCardData(new Set(['Sol Ring']))
    expect(collection.cardsCardKingdom).toBeUndefined()
  })

  test('a deployment that does not offer CK prices ships no picks', async () => {
    await setPriceSources(['tcgplayer'])

    const deck = await loadDeckCardData(new Set(['Sol Ring']))
    const entries = await loadEntryCardData(new Set(['Sol Ring']), { cardKingdomPicks: true })

    expect(deck.cardsCardKingdom).toBeUndefined()
    expect(deck.lowestPriceCardsCardKingdom).toBeUndefined()
    expect(entries.cardsCardKingdom).toBeUndefined()
  })

  test('CK enabled with no feed downloaded ships no picks, and downloads nothing', async () => {
    await setPriceSources(['tcgplayer', 'cardkingdom'])
    const cachePath = getCardKingdomCachePath()
    const saved = await fs.readFile(cachePath)
    await fs.rm(cachePath)
    invalidateCardKingdomIndex()

    try {
      const deck = await loadDeckCardData(new Set(['Sol Ring']))
      expect(deck.cardsCardKingdom).toBeUndefined()
      // The load must not have fetched one: a ~70 MB download on an editor open
      // is exactly what the cache-only lookup exists to prevent.
      expect(await Bun.file(cachePath).exists()).toBe(false)
    } finally {
      await fs.writeFile(cachePath, saved)
      invalidateCardKingdomIndex()
    }
  })
})
