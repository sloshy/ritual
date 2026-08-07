import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getBaseDir, setBaseDir } from '../../../src/base-dir'
import { cardCache } from '../../../src/cache'
import { createLiveSiteData } from '../../../src/serve/live-data'
import { createSyntheticWorkspace } from '../../e2e/helpers/synthetic-workspace'
import type { DeckDetail, SiteIndex } from '../../../src/site/data-types'

describe('createLiveSiteData', () => {
  let dir: string
  let originalBase: string
  let originalFetch: typeof fetch

  beforeEach(async () => {
    originalBase = getBaseDir()
    originalFetch = globalThis.fetch
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-live-data-'))
    createSyntheticWorkspace(dir)
    setBaseDir(dir)
    cardCache.invalidate()
    // The live layer must be fully offline: any network attempt is a bug.
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      throw new Error(`Unexpected network request: ${url}`)
    }) as unknown as typeof fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    setBaseDir(originalBase)
    cardCache.invalidate()
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('serves a live index with the same-origin marker and all seeded lists', async () => {
    const live = createLiveSiteData()
    const result = await live.getIndex()
    const index = JSON.parse(result.body) as SiteIndex

    expect(index.apiBaseUrl).toBe('')
    expect(index.useScryfallImgUrls).toBeTrue()
    expect(index.decks.map((d) => d.slug).sort()).toEqual([
      'emberwild-aggro',
      'test-unset-commander',
    ])
    expect(index.collections.map((c) => c.slug)).toEqual(['test-binder'])
    expect(index.wantedLists?.map((w) => w.slug)).toEqual(['test-wants'])
    expect(result.etag).toMatch(/^"[0-9a-f]+"$/)
  })

  test('serves deck details in the baked shape and 404s unknown slugs', async () => {
    const live = createLiveSiteData()
    const result = await live.getDetail('deck', 'emberwild-aggro')
    expect(result).not.toBeNull()
    const detail = JSON.parse(result!.body) as DeckDetail

    expect(detail.deck.name).toBe('Emberwild Aggro')
    // A specific seeded card resolved from the cache — not just map keys, which
    // the section loop creates even when resolution fails.
    expect(detail.cards['Lightning Bolt']?.name).toBe('Lightning Bolt')
    expect(detail.cards['Lightning Bolt']?.prices.usd).toBeTruthy()
    expect(detail.useScryfallImgUrls).toBeTrue()
    expect(detail.availableCurrencies).toEqual(['usd', 'eur', 'tix'])

    expect(await live.getDetail('deck', 'no-such-deck')).toBeNull()
    expect(await live.getDetail('collection', 'emberwild-aggro')).toBeNull()
  })

  test('memoizes unchanged lists (stable ETags) and rebuilds on file edits', async () => {
    const live = createLiveSiteData()
    const first = await live.getDetail('deck', 'emberwild-aggro')
    const second = await live.getDetail('deck', 'emberwild-aggro')
    expect(second!.etag).toBe(first!.etag)

    const deckPath = path.join(dir, 'decks', 'emberwild-aggro.md')
    const content = await fs.readFile(deckPath, 'utf-8')
    await Bun.sleep(5)
    await fs.writeFile(
      deckPath,
      content.replace('name: "Emberwild Aggro"', 'name: "Emberwild Renamed"'),
    )

    // The renamed deck lives under a new slug; the old one is gone.
    const renamed = await live.getDetail('deck', 'emberwild-renamed')
    expect(renamed).not.toBeNull()
    expect((JSON.parse(renamed!.body) as DeckDetail).deck.name).toBe('Emberwild Renamed')
    expect(await live.getDetail('deck', 'emberwild-aggro')).toBeNull()
  })

  test('rebuilds when the changelog sidecar changes', async () => {
    const live = createLiveSiteData()
    const before = await live.getDetail('deck', 'emberwild-aggro')
    expect((JSON.parse(before!.body) as DeckDetail).changelog).toBeUndefined()

    await Bun.sleep(5)
    fsSync.writeFileSync(
      path.join(dir, 'decks', 'emberwild-aggro.changes.md'),
      '## 2026-07-24T10:00:00.000Z\n\n- Added Lightning Bolt &99\n',
    )

    const after = await live.getDetail('deck', 'emberwild-aggro')
    expect(after!.etag).not.toBe(before!.etag)
    expect((JSON.parse(after!.body) as DeckDetail).changelog).toBeDefined()
  })

  test('serves the configured defaultLanguage, honoring a config edit without a restart', async () => {
    const live = createLiveSiteData()
    const before = JSON.parse((await live.getIndex()).body) as SiteIndex
    expect(before.defaultLanguage).toBe('en')

    const configPath = path.join(dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    config.defaultLanguage = 'ja'
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))

    const after = JSON.parse((await live.getIndex()).body) as SiteIndex
    expect(after.defaultLanguage).toBe('ja')
  })

  test('honors selection config changes without a restart', async () => {
    const live = createLiveSiteData()
    expect(await live.getDetail('deck', 'emberwild-aggro')).not.toBeNull()

    const configPath = path.join(dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    // Selection lists match on display names, not file basenames.
    config.site = { excludeDecks: ['Emberwild Aggro'] }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))

    expect(await live.getDetail('deck', 'emberwild-aggro')).toBeNull()
    const index = JSON.parse((await live.getIndex()).body) as SiteIndex
    expect(index.decks.map((d) => d.slug)).toEqual(['test-unset-commander'])
  })
})
