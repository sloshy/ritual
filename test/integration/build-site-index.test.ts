import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../src/cache'
import { refreshRitualConfig } from '../../src/config/ritual-config'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { runBuildSite } from '../../src/commands/build-site'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import type { SiteIndex } from '../../src/list/site-data'

/**
 * Wiring pin: a configured `site.apiBaseUrl` is baked into the built
 * `index.json` (the split-deployment marker the SPA reads). The URL parsing
 * itself is unit-tested in ritual-config.test.ts; this covers the one
 * build-side integration point.
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
  }, 120_000)
})
