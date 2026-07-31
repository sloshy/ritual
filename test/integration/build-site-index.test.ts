import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getBaseDir, setBaseDir } from '../../src/base-dir'
import { cardCache } from '../../src/cache'
import { refreshRitualConfig, resetRitualConfigCache } from '../../src/ritual-config'
import { runBuildSite } from '../../src/commands/build-site'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import type { SiteIndex } from '../../src/site/data-types'

/**
 * Wiring pin: a configured `site.apiBaseUrl` is baked into the built
 * `index.json` (the split-deployment marker the SPA reads). The URL parsing
 * itself is unit-tested in ritual-config.test.ts; this covers the one
 * build-side integration point.
 */
describe('build-site index baking (Integration)', () => {
  let dir: string
  let originalBase: string

  beforeAll(async () => {
    originalBase = getBaseDir()
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-build-index-'))
    createSyntheticWorkspace(dir)
    const configPath = path.join(dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    config.site = { apiBaseUrl: 'https://ritual-api.example.com' }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
    setBaseDir(dir)
    resetRitualConfigCache()
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  afterAll(async () => {
    setBaseDir(originalBase)
    resetRitualConfigCache()
    await refreshRitualConfig()
    cardCache.invalidate()
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('bakes site.apiBaseUrl into index.json', async () => {
    await runBuildSite({ refresh: 'never' })
    const raw = await fs.readFile(path.join(dir, 'dist', 'index.json'), 'utf-8')
    const index = JSON.parse(raw) as SiteIndex
    expect(index.apiBaseUrl).toBe('https://ritual-api.example.com')
    expect(index.decks.length).toBeGreaterThan(0)
  }, 120_000)
})
