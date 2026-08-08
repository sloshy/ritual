import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getBaseDir, setBaseDir } from '../../src/base-dir'
import { cardCache } from '../../src/cache'
import {
  clearSiteSellModeOverride,
  refreshRitualConfig,
  resetRitualConfigCache,
} from '../../src/ritual-config'
import { invalidateCardKingdomIndex, saveCardKingdomCache } from '../../src/cardkingdom'
import { runBuildSite } from '../../src/commands/build-site'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../test-utils'
import type { CollectionDetail, SiteIndex, WantedListDetail } from '../../src/site/data-types'

/**
 * The build's half of baked sell mode: `--sell-mode` turns the buylist on for
 * one run, and every list detail ships the offers for the printings it
 * displays, so a static host serves sell mode with no quote API at all.
 *
 * One representative build, from a synthetic workspace and a synthetic Card
 * Kingdom cache file — `--refresh never` guarantees nothing is downloaded.
 * Which printing a builder decides a tile displays (finish resolution, the
 * non-English exclusion, dedupe) is pinned at the unit layer in
 * test/unit/site/details.test.ts.
 */
describe('build-site buylist baking (Integration)', () => {
  let dir: string
  let originalBase: string
  /**
   * When this run downloaded the feed; staleness derives from it in the
   * browser. (The buyer's *own* generation stamp is `feedCreatedAt`, which
   * `makeCardKingdomCacheFile` fixes at 2026-08-04.)
   */
  const FEED_RETRIEVED_AT = Date.now()

  beforeAll(async () => {
    originalBase = getBaseDir()
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-build-buylist-'))
    createSyntheticWorkspace(dir)
    setBaseDir(dir)
    resetRitualConfigCache()
    await refreshRitualConfig()
    cardCache.invalidate()
    // The synthetic binder holds Serra Angel (FDN:35), a *foil* Lightning Bolt
    // (LEA:161) and a Sol Ring (C21:263). The buyer stocks the first two; the
    // Sol Ring is what proves the baked map is sparse rather than zero-filled.
    await saveCardKingdomCache(
      makeCardKingdomCacheFile(
        [
          makeCardKingdomProduct({
            id: 1,
            sku: 'FDN-0035',
            scryfallId: 'e2e00000-0000-4000-8000-000000000007',
            name: 'Serra Angel',
            edition: 'Foundations',
            finish: 'nonfoil',
            priceBuy: 0.25,
            qtyBuying: 8,
          }),
          makeCardKingdomProduct({
            id: 2,
            sku: 'FLEA-0161',
            scryfallId: 'e2e00000-0000-4000-8000-000000000003',
            name: 'Lightning Bolt',
            edition: 'Limited Edition Alpha',
            finish: 'foil',
            priceBuy: 30,
            qtyBuying: 2,
          }),
        ],
        FEED_RETRIEVED_AT,
      ),
    )
    invalidateCardKingdomIndex()
  })

  afterAll(async () => {
    clearSiteSellModeOverride()
    invalidateCardKingdomIndex()
    setBaseDir(originalBase)
    resetRitualConfigCache()
    await refreshRitualConfig()
    cardCache.invalidate()
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('--sell-mode bakes the buyer’s offers into each list detail', async () => {
    // No `site.sellMode` in this workspace's config: the flag alone turns the
    // whole run's sell mode on, through the session override.
    await runBuildSite({ refresh: 'never', sellMode: true })

    const index = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'index.json'), 'utf-8'),
    ) as SiteIndex
    expect(index.sellMode).toBe(true)

    const detail = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'collections', 'test-binder.json'), 'utf-8'),
    ) as CollectionDetail
    const baked = detail.buylist?.cardkingdom
    expect(baked).toBeDefined()
    expect(baked?.feedRetrievedAt).toBe(FEED_RETRIEVED_AT)
    expect(baked?.feedCreatedAt).toBe('2026-08-04 06:06:09')
    // Keyed by the printing each tile displays — the foil Bolt under its foil
    // key — and sparse: the unstocked Sol Ring has no entry at all.
    expect(Object.keys(baked?.quotes ?? {}).sort()).toEqual(['fdn:35:nonfoil', 'lea:161:foil'])
    expect(baked?.quotes['lea:161:foil']).toMatchObject({
      priceBuy: 30,
      buying: true,
      finish: 'foil',
    })

    // Every list type carries the field, not just collections: the wanted
    // list wants the same Serra Angel.
    const wanted = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'wanted', 'test-wants.json'), 'utf-8'),
    ) as WantedListDetail
    expect(wanted.buylist?.cardkingdom?.quotes['fdn:35:nonfoil']).toBeDefined()
  }, 180_000)

  test('a default build bakes nothing, even with a feed sitting in the cache', async () => {
    // Sell mode is off unless asked for, and off means the feed on disk is
    // never touched: no `buylist` field, and `index.json` says the site does
    // not offer the mode, so the toggle is not rendered at all.
    clearSiteSellModeOverride()

    await runBuildSite({ refresh: 'never' })

    const index = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'index.json'), 'utf-8'),
    ) as SiteIndex
    expect(index.sellMode).toBe(false)

    const detail = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'collections', 'test-binder.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(detail).not.toHaveProperty('buylist')
  }, 180_000)

  // Last: it removes the feed the tests above build against.
  test('sell mode with no buylist warns and builds without offers', async () => {
    // `--refresh never` plus no cache file is a guaranteed refusal, so nothing
    // is downloaded to reach the branch.
    await fs.rm(path.join(dir, 'cache', 'cardkingdom.json'))
    invalidateCardKingdomIndex()

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '))
    try {
      await runBuildSite({ refresh: 'never', sellMode: true })
    } finally {
      console.warn = originalWarn
    }

    // The build says why rather than failing, and names the remedy.
    expect(warnings.join('\n')).toContain('Sell mode is on but the Card Kingdom buylist')
    expect(warnings.join('\n')).toContain('--refresh auto')

    const index = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'index.json'), 'utf-8'),
    ) as SiteIndex
    // The toggle is still offered — the flag alone decides that…
    expect(index.sellMode).toBe(true)

    // …with nothing behind it. An absent `buylist` field is what makes the
    // client explain the gap instead of reading every card as declined.
    const detail = JSON.parse(
      await fs.readFile(path.join(dir, 'dist', 'collections', 'test-binder.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(detail).not.toHaveProperty('buylist')
  }, 180_000)
})
