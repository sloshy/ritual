import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../src/cache'
import {
  clearSiteSellModeOverride,
  refreshRitualConfig,
  resetRitualConfigCache,
} from '../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { invalidateCardKingdomIndex, saveCardKingdomCache } from '../../src/cardkingdom'
import { runBuildSite } from '../../src/commands/build-site'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../test-utils'
import type {
  CollectionDetail,
  DeckDetail,
  SiteIndex,
  WantedListDetail,
} from '../../src/list/site-data'
import { captureConsole } from '../helpers/capture'

/**
 * The build's half of baked sell mode: `--sell-mode` turns the buylist on for
 * one run, and every list detail ships the offers for the printings it
 * displays, so a static host serves sell mode with no quote API at all.
 *
 * One representative build, from a synthetic workspace and a synthetic Card
 * Kingdom cache file — `--refresh never` guarantees nothing is downloaded.
 * Which printing a builder decides a tile displays (finish resolution, the
 * non-English exclusion, dedupe) is pinned at the unit layer in
 * test/unit/site-build/details.test.ts.
 */
describe('build-site buylist baking (Integration)', () => {
  let ws: BoundWorkspace
  /**
   * When this run downloaded the feed; staleness derives from it in the
   * browser. (The buyer's *own* generation stamp is `feedCreatedAt`, which
   * `makeCardKingdomCacheFile` fixes at 2026-08-04.)
   */
  const FEED_RETRIEVED_AT = Date.now()

  beforeAll(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    createSyntheticWorkspace(ws.dir)
    await refreshRitualConfig()
    cardCache.invalidate()
    // The synthetic binder holds Serra Angel (FDN:35), a *foil* Lightning Bolt
    // (LEA:161) and a Sol Ring (C21:263). The buyer stocks the first two; the
    // Sol Ring is what proves the baked map is sparse rather than zero-filled.
    await seedFeed()
  })

  /**
   * Write the buyer's feed. A helper rather than inline setup because one case
   * below deletes the file to reach the no-feed branch, and every case after it
   * needs it back.
   */
  async function seedFeed(): Promise<void> {
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
  }

  afterAll(async () => {
    clearSiteSellModeOverride()
    invalidateCardKingdomIndex()
    await ws.dispose()
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  test('--sell-mode bakes the buyer’s offers into each list detail', async () => {
    // No `site.sellMode` in this workspace's config: the flag alone turns the
    // whole run's sell mode on, through the session override.
    await runBuildSite({ refresh: 'never', sellMode: true })

    const index = JSON.parse(
      await fs.readFile(path.join(ws.dir, 'dist', 'index.json'), 'utf-8'),
    ) as SiteIndex
    expect(index.sellMode).toBe(true)

    const detail = JSON.parse(
      await fs.readFile(path.join(ws.dir, 'dist', 'collections', 'test-binder.json'), 'utf-8'),
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
      await fs.readFile(path.join(ws.dir, 'dist', 'wanted', 'test-wants.json'), 'utf-8'),
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
      await fs.readFile(path.join(ws.dir, 'dist', 'index.json'), 'utf-8'),
    ) as SiteIndex
    expect(index.sellMode).toBe(false)

    const detail = JSON.parse(
      await fs.readFile(path.join(ws.dir, 'dist', 'collections', 'test-binder.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(detail).not.toHaveProperty('buylist')
  }, 180_000)

  // Last: it removes the feed the tests above build against.
  test('sell mode with no buylist warns and builds without offers', async () => {
    // `--refresh never` plus no cache file is a guaranteed refusal, so nothing
    // is downloaded to reach the branch.
    await fs.rm(path.join(ws.dir, 'cache', 'cardkingdom.json'))
    invalidateCardKingdomIndex()

    const { lines } = await captureConsole(['warn'], () =>
      runBuildSite({ refresh: 'never', sellMode: true }),
    )

    // The build says why rather than failing, and names the remedy.
    expect(lines.warn.join('\n')).toContain('Sell mode is on but the Card Kingdom buylist')
    expect(lines.warn.join('\n')).toContain('--refresh auto')

    const index = JSON.parse(
      await fs.readFile(path.join(ws.dir, 'dist', 'index.json'), 'utf-8'),
    ) as SiteIndex
    // The toggle is still offered — the flag alone decides that…
    expect(index.sellMode).toBe(true)

    // …with nothing behind it. An absent `buylist` field is what makes the
    // client explain the gap instead of reading every card as declined.
    const detail = JSON.parse(
      await fs.readFile(path.join(ws.dir, 'dist', 'collections', 'test-binder.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(detail).not.toHaveProperty('buylist')
  }, 180_000)

  test('the cardkingdom price store bakes CK’s own printing picks into a deck detail', async () => {
    // Sell mode is not what turns this on: the `cardkingdom` price store does,
    // and it must reach the *card fetch loop*, where the picks are made.
    // (The no-buylist case above removed the feed; this needs it back.)
    await seedFeed()
    const configPath = path.join(ws.dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    await fs.writeFile(
      configPath,
      JSON.stringify({ ...config, priceSources: ['tcgplayer', 'cardkingdom'] }, null, 2),
    )
    resetRitualConfigCache()
    await refreshRitualConfig()

    await runBuildSite({ refresh: 'never' })

    const deck = JSON.parse(
      await fs.readFile(path.join(ws.dir, 'dist', 'decks', 'emberwild-aggro.json'), 'utf-8'),
    ) as DeckDetail

    // The buyer stocks Serra Angel's only printing, so it gets a pick. Lightning
    // Bolt it stocks only as a *foil*, and a name-only line is picked at the
    // printing's display finish (nonfoil here) — so the map is sparse, and the
    // Bolt keeps its Scryfall pick and prices at nothing under Card Kingdom.
    expect(deck.cardsCardKingdom?.['Serra Angel']?.set).toBe('fdn')
    expect(deck.cardsCardKingdom?.['Lightning Bolt']).toBeUndefined()
    // The Scryfall map is untouched — the CK map is an override layer.
    expect(deck.cards['Serra Angel']?.set).toBe('fdn')

    // And the CK store also bakes the *alternate* printings, so the card
    // modal's other-printings grid and the printing pickers can price a
    // printing no tile displays without a backend. The foil Bolt is the proof:
    // the deck's line displays it nonfoil, so only quoting displayed printings
    // (the `--sell-mode` case above) leaves that key out entirely.
    // Card Kingdom sells this Bolt only as a foil, and the deck's line names no
    // finish — so `lea:161:foil` is not a printing any tile of this deck
    // displays, and can only be here because the alternate printings were baked
    // too. (The `--sell-mode` case above, which leaves the flag off, bakes the
    // displayed printings alone.)
    expect(Object.keys(deck.buylist?.cardkingdom?.quotes ?? {})).toContain('lea:161:foil')
  })
})
