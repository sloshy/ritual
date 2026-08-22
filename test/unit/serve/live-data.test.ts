import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getBaseDir, setBaseDir } from '../../../src/base-dir'
import { cardCache } from '../../../src/cache'
import { invalidateCardKingdomIndex, saveCardKingdomCache } from '../../../src/cardkingdom'
import { createLiveSiteData } from '../../../src/serve/live-data'
import { createSyntheticWorkspace } from '../../e2e/helpers/synthetic-workspace'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../../test-utils'
import type {
  BakedDeckCard,
  CollectionDetail,
  DeckDetail,
  SiteIndex,
} from '../../../src/site/data-types'

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
    // The buyer-feed memo is process-global and keyed on a path this workspace
    // is about to take with it.
    invalidateCardKingdomIndex()
    await fs.rm(dir, { recursive: true, force: true })
  })

  /** The deck line with this `&N` id, from a served deck detail body. */
  function deckCard(body: string, cardId: number): BakedDeckCard {
    const detail = JSON.parse(body) as DeckDetail
    const card = detail.deck.sections
      .flatMap((section) => section.cards)
      .find((entry) => entry.cardId === cardId)
    if (!card) throw new Error(`No card &${cardId} in the served deck`)
    return card
  }

  /** Merge `patch` into the workspace's config file, which the live layer re-reads. */
  async function patchConfig(patch: Record<string, unknown>): Promise<void> {
    const configPath = path.join(dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    await fs.writeFile(configPath, JSON.stringify({ ...config, ...patch }, null, 2))
  }

  test('serves a live index with the same-origin marker and all seeded lists', async () => {
    const live = createLiveSiteData()
    const result = await live.getIndex()
    const index = JSON.parse(result.body) as SiteIndex

    expect(index.apiBaseUrl).toBe('')
    expect(index.useScryfallImgUrls).toBeTrue()
    expect(index.decks.map((d) => d.slug).sort()).toEqual([
      'emberwild-aggro',
      'test-swap-deck',
      'test-unset-commander',
    ])
    expect(index.collections.map((c) => c.slug).sort()).toEqual(['test-binder', 'test-swap-binder'])
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

  test('rebuilds when the custom-art sidecar changes', async () => {
    // Art lives in its own sidecar, so nothing else about the list moves when it
    // is edited — without the art stamp the memo would serve the old detail
    // until the markdown itself changed.
    const live = createLiveSiteData()
    const before = await live.getDetail('deck', 'emberwild-aggro')
    expect(deckCard(before!.body, 1).customArt).toBeUndefined()
    const indexBefore = await live.getIndex()

    const artPath = path.join(dir, 'decks', 'emberwild-aggro.art.json')
    fsSync.writeFileSync(artPath, '{"1":{"url":"https://example.test/bolt.png"}}\n')
    // Last-Modified has second resolution; stamp the sidecar far enough ahead
    // that the header has to move rather than sleeping for a second.
    const later = new Date(Date.now() + 60_000)
    fsSync.utimesSync(artPath, later, later)

    const after = await live.getDetail('deck', 'emberwild-aggro')
    expect(after!.lastModified).not.toBe(before!.lastModified)
    expect(deckCard(after!.body, 1).customArt).toBe('https://example.test/bolt.png')
    // The index is built from the same files, and its summaries carry totals
    // that custom art changes — so its Last-Modified has to move with the art
    // sidecar too, not just the detail's.
    expect((await live.getIndex()).lastModified).not.toBe(indexBefore.lastModified)
  })

  test('bakes a local art reference as the path the /art route serves', async () => {
    fsSync.writeFileSync(
      path.join(dir, 'decks', 'emberwild-aggro.art.json'),
      '{"2":{"file":"proxies/bolt.png"}}\n',
    )
    const live = createLiveSiteData()

    const detail = await live.getDetail('deck', 'emberwild-aggro')

    // Nothing is deployed in live mode, so the reference is baked whether or not
    // the file is there — `/art/*` reads the art directory on request.
    expect(deckCard(detail!.body, 2).customArt).toBe('art/proxies/bolt.png')
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

  /**
   * The live server's half of baked sell mode: the same quotes `build-site`
   * writes into a static detail, served per request — and the feed's identity
   * folded into the detail memo's stamp, so an out-of-band `ritual sell
   * --refresh` is picked up instead of serving yesterday's offers forever.
   */
  describe('baked buylist quotes', () => {
    const QUOTE_KEY = 'fdn:35:nonfoil'
    /** The synthetic binder's Serra Angel (FDN:35), which the stub buyer stocks. */
    const angelProduct = (priceBuy: number) =>
      makeCardKingdomProduct({
        id: 1,
        sku: 'FDN-0035',
        scryfallId: 'e2e00000-0000-4000-8000-000000000007',
        name: 'Serra Angel',
        edition: 'Foundations',
        priceBuy,
      })

    async function seedFeed(priceBuy: number, retrievedAt: number): Promise<void> {
      await saveCardKingdomCache(makeCardKingdomCacheFile([angelProduct(priceBuy)], retrievedAt))
      invalidateCardKingdomIndex()
    }

    function binderQuotes(body: string): CollectionDetail['buylist'] {
      return (JSON.parse(body) as CollectionDetail).buylist
    }

    test('bakes the offers into the detail, and rebuilds when the feed is refreshed', async () => {
      await patchConfig({ site: { sellMode: true } })
      await seedFeed(3, Date.now() - 60_000)

      const live = createLiveSiteData()
      const first = await live.getDetail('collection', 'test-binder')
      const baked = binderQuotes(first!.body)?.cardkingdom
      expect(baked?.quotes[QUOTE_KEY]).toMatchObject({ priceBuy: 3, buying: true })
      expect(baked?.feedCreatedAt).toBe('2026-08-04 06:06:09')

      // A newer feed under the same lists: without the feed's identity in the
      // memo stamp the detail would be served from cache at the old price.
      await Bun.sleep(5)
      await seedFeed(99, Date.now())

      const second = await live.getDetail('collection', 'test-binder')
      expect(second!.etag).not.toBe(first!.etag)
      expect(binderQuotes(second!.body)?.cardkingdom?.quotes[QUOTE_KEY]?.priceBuy).toBe(99)
    })

    test('the cardkingdom price store gets CK printing picks in the live payload', async () => {
      // No sell mode: the `cardkingdom` store alone must load the feed and reach
      // the printing selection — the two-condition gate in `makeContext`.
      await patchConfig({ priceSources: ['tcgplayer', 'cardkingdom'] })
      await seedFeed(3, Date.now())

      const detail = await createLiveSiteData().getDetail('deck', 'emberwild-aggro')
      const deck = JSON.parse(detail!.body) as DeckDetail

      // The buyer stocks Serra Angel (FDN:35) and nothing else this deck wants,
      // so the map is present *and* sparse — the deck's other name-only lines
      // keep their Scryfall picks.
      expect(deck.cardsCardKingdom?.['Serra Angel']?.set).toBe('fdn')
      expect(deck.cardsCardKingdom?.['Dark Ritual']).toBeUndefined()
    })

    test('the cardkingdom price store also bakes the alternate printings', async () => {
      // The other-printings grid and the printing pickers price printings no
      // tile displays, and a static client cannot fetch a quote it was not
      // given — so the price store (not sell mode) widens the bake. The build's
      // twin of this is in test/integration/build-site-buylist.test.ts; the two
      // paths must agree or `serve --api` ships a different quote set.
      await patchConfig({ priceSources: ['tcgplayer', 'cardkingdom'] })
      await saveCardKingdomCache(
        makeCardKingdomCacheFile(
          [
            angelProduct(3),
            makeCardKingdomProduct({
              id: 2,
              sku: 'FFDN-0035',
              scryfallId: 'e2e00000-0000-4000-8000-000000000007',
              name: 'Serra Angel',
              edition: 'Foundations',
              finish: 'foil',
              priceBuy: 9,
            }),
          ],
          Date.now(),
        ),
      )
      invalidateCardKingdomIndex()

      const detail = await createLiveSiteData().getDetail('deck', 'emberwild-aggro')
      const quotes = (JSON.parse(detail!.body) as DeckDetail).buylist?.cardkingdom?.quotes ?? {}

      // The deck's line names no finish, so the Angel displays nonfoil: the foil
      // key exists only because every finish of every printing was quoted.
      expect(quotes[QUOTE_KEY]).toMatchObject({ priceBuy: 3 })
      expect(quotes['fdn:35:foil']).toMatchObject({ priceBuy: 9 })
    })

    test('a deployment without the cardkingdom store gets no picks, feed or no feed', async () => {
      await patchConfig({ priceSources: ['tcgplayer'] })
      await seedFeed(3, Date.now())

      const detail = await createLiveSiteData().getDetail('deck', 'emberwild-aggro')

      expect(JSON.parse(detail!.body)).not.toHaveProperty('cardsCardKingdom')
    })

    test('sell mode off ships no buylist field at all, feed on disk or not', async () => {
      await seedFeed(3, Date.now())

      const live = createLiveSiteData()
      const detail = await live.getDetail('collection', 'test-binder')

      // Absent, not empty: the client reads an empty map as "the buyer declined
      // every card" and an absent field as "this list was never quoted".
      expect(JSON.parse(detail!.body)).not.toHaveProperty('buylist')
      expect((JSON.parse((await live.getIndex()).body) as SiteIndex).sellMode).toBe(false)
    })
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
    expect(index.decks.map((d) => d.slug).sort()).toEqual([
      'test-swap-deck',
      'test-unset-commander',
    ])
  })
})
