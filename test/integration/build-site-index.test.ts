import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../src/cache'
import { refreshRitualConfig } from '../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { runBuildSite } from '../../src/commands/build-site'
import { captureExitCode } from '../helpers/cli'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import type { SiteIndex } from '../../src/list/site-data'

/**
 * Wiring pins: a configured `site.apiBaseUrl` and the store-derived currencies
 * are baked into the built `index.json`. The URL parsing and the currency rule
 * are unit-tested (ritual-config.test.ts, price-source.test.ts); this covers
 * the build-side integration points.
 */
describe('build-site index baking (Integration)', () => {
  let ws: BoundWorkspace

  beforeAll(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    createSyntheticWorkspace(ws.dir)
    const configPath = path.join(ws.dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    config.site = { apiBaseUrl: 'https://ritual-api.example.com' }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  afterAll(async () => {
    await ws.dispose()
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  test('bakes site.apiBaseUrl into index.json', async () => {
    await runBuildSite({ refresh: 'never' })
    const raw = await fs.readFile(path.join(ws.dir, 'dist', 'index.json'), 'utf-8')
    const index = JSON.parse(raw) as SiteIndex
    expect(index.apiBaseUrl).toBe('https://ritual-api.example.com')
    expect(index.decks.length).toBeGreaterThan(0)
    // The synthetic workspace enables tcgplayer + cardmarket: no cardhoarder, no tix.
    expect(index.availableCurrencies).toEqual(['usd', 'eur'])
  }, 120_000)

  test('--currencies naming only store-less currencies is refused before building', async () => {
    await fs.rm(path.join(ws.dir, 'dist'), { recursive: true, force: true })
    expect(await captureExitCode(() => runBuildSite({ refresh: 'never', currencies: 'tix' }))).toBe(
      2,
    )
    expect(await Bun.file(path.join(ws.dir, 'dist', 'index.json')).exists()).toBeFalse()
  })
})
