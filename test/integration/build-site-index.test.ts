import { describe, test, expect, beforeAll, afterAll, spyOn } from 'bun:test'
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
 * are baked into the built `index.json`, and `site.theme` / `site.themeFiles`
 * pick the theme the built shell opens on. The URL parsing and the currency rule
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
    // The opening theme comes from config alone — the CI build passes no theme
    // flags — and it names a custom theme loaded from a base-dir-relative file.
    config.site = {
      apiBaseUrl: 'https://ritual-api.example.com',
      theme: 'sunset',
      themeFiles: ['themes/sunset.json'],
    }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
    await fs.mkdir(path.join(ws.dir, 'themes'))
    await fs.writeFile(
      path.join(ws.dir, 'themes', 'sunset.json'),
      JSON.stringify({ name: 'sunset', variables: { '--bg': '#123456' } }),
    )
    await fs.writeFile(
      path.join(ws.dir, 'themes', 'dusk.json'),
      JSON.stringify({ name: 'dusk', variables: { '--bg': '#654321' } }),
    )
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  afterAll(async () => {
    await ws.dispose()
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  test('bakes site.apiBaseUrl into index.json and opens on the configured theme', async () => {
    await runBuildSite({ refresh: 'never' })
    const raw = await fs.readFile(path.join(ws.dir, 'dist', 'index.json'), 'utf-8')
    const index = JSON.parse(raw) as SiteIndex
    expect(index.apiBaseUrl).toBe('https://ritual-api.example.com')
    expect(index.decks.length).toBeGreaterThan(0)
    // The synthetic workspace enables tcgplayer + cardmarket, and the index offers exactly those.
    expect(index.priceSources).toEqual(['tcgplayer', 'cardmarket'])
    // site.theme / site.themeFiles: the custom theme is built in and opens the site.
    const html = await fs.readFile(path.join(ws.dir, 'dist', 'index.html'), 'utf-8')
    expect(html).toContain('data-theme="sunset"')
    const css = await fs.readFile(path.join(ws.dir, 'dist', 'styles.css'), 'utf-8')
    expect(css).toContain('#123456')
  }, 120_000)

  test('a site.theme no loaded file declares is refused, naming the config key, before building', async () => {
    await fs.rm(path.join(ws.dir, 'dist'), { recursive: true, force: true })
    const errors = spyOn(console, 'error').mockImplementation(() => {})
    try {
      // --theme-file replaces site.themeFiles, so the configured `sunset` is no longer loaded.
      expect(
        await captureExitCode(() =>
          runBuildSite({ refresh: 'never', themeFile: [path.join(ws.dir, 'themes', 'dusk.json')] }),
        ),
      ).toBe(1)
      expect(String(errors.mock.calls[0]?.[0])).toStartWith("site.theme names theme 'sunset'")
    } finally {
      errors.mockRestore()
    }
    expect(await Bun.file(path.join(ws.dir, 'dist', 'index.json')).exists()).toBeFalse()
  })

  test('--price-sources naming only stores priceSources does not enable is refused before building', async () => {
    await fs.rm(path.join(ws.dir, 'dist'), { recursive: true, force: true })
    const errors = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(
        await captureExitCode(() =>
          runBuildSite({ refresh: 'never', priceSources: 'cardhoarder,cardkingdom' }),
        ),
      ).toBe(2)
      // Both lists are joined by the locale's list format, not a hard-coded comma.
      expect(errors.mock.calls.map((call) => String(call[0]))).toContain(
        '--price-sources cardhoarder, cardkingdom names no store priceSources enables (priceSources: tcgplayer, cardmarket). Enable it first, e.g. `ritual config set priceSources --add cardhoarder`.',
      )
    } finally {
      errors.mockRestore()
    }
    expect(await Bun.file(path.join(ws.dir, 'dist', 'index.json')).exists()).toBeFalse()
  })
})
