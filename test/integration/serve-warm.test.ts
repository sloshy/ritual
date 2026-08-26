import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../src/cache/instances'
import { warmCardKingdomFeed } from '../../src/cardkingdom'
import { primerSidecarPath } from '../../src/list/list-sidecars'
import { warmSiteCache, type SiteCacheWarmth, type WarmDeps } from '../../src/serve/warm'
import { DenyHttpClient, makeScryfallCard } from '../test-utils'
import {
  bindWorkspace,
  snapshotTree,
  writeCollectionFile,
  writeConfig,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from './helpers/workspace'

/**
 * `serve --api` warms the card cache over the cards it is about to serve, so
 * *which* cards those are is the property worth pinning: the same lists the live
 * index enumerates (site selection config included), and — for every list kind —
 * the same entry, primer, and changelog references the detail payloads resolve.
 * A name missed here is a card the live site renders blank.
 *
 * The gates themselves are unit-tested in cache-freshness.test.ts; the stubs
 * below stand in for them so nothing in this file can reach the network.
 */
describe('warmSiteCache (Integration)', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace({ clearCardCache: true })
  })

  afterEach(async () => {
    await workspace.dispose()
  })

  /** What the warm's gates were handed, captured instead of executed. */
  type WarmRun = {
    warmth: SiteCacheWarmth
    /** The card names the bulk gate was asked to ensure, sorted. */
    names: string[]
    priceCalls: number
    tagCalls: number
  }

  /** Run the warm with every gate stubbed, recording what it passed them. */
  async function runWarm(overrides: WarmDeps = {}): Promise<WarmRun> {
    const run: WarmRun = {
      warmth: { ready: false, siteCardCount: 0 },
      names: [],
      priceCalls: 0,
      tagCalls: 0,
    }
    run.warmth = await warmSiteCache('never', {
      ensureCards: async (names) => {
        run.names = [...names].sort()
        return false
      },
      offerPrices: async () => {
        run.priceCalls++
      },
      hasTags: async () => true,
      offerTags: async () => {
        run.tagCalls++
      },
      ...overrides,
    })
    return run
  }

  async function seedLists(): Promise<void> {
    await writeDeckFile(workspace.dir, 'aggro', {
      frontMatter: { name: 'Aggro' },
      cards: [
        { name: 'Lightning Bolt', quantity: 4 },
        { name: 'Mountain', quantity: 20 },
      ],
    })
    await writeCollectionFile(workspace.dir, 'main', {
      entries: [{ name: 'Sol Ring', set: 'lea', collectorNumber: '270', cardId: 1 }],
    })
    await writeWantedFile(workspace.dir, 'needs', {
      entries: [{ name: 'Black Lotus', cardId: 1 }],
    })
  }

  test('warms every card across every served list kind', async () => {
    await seedLists()

    const run = await runWarm()

    expect(run.names).toEqual(['Black Lotus', 'Lightning Bolt', 'Mountain', 'Sol Ring'])
    expect(run.warmth.siteCardCount).toBe(4)
  })

  test('honours the site selection config, like the live index does', async () => {
    await seedLists()
    await writeConfig(workspace.dir, { site: { includeDecks: [], includeWantedLists: [] } })

    const run = await runWarm()

    // Decks and wanted lists are deselected: only the collection's card is left.
    expect(run.names).toEqual(['Sol Ring'])
  })

  test('warms primer references, canonicalized the way the payload builders resolve them', async () => {
    await cardCache.set('Lightning Bolt', [makeScryfallCard({ name: 'Lightning Bolt' })])
    const deckPath = await writeDeckFile(workspace.dir, 'aggro', {
      frontMatter: { name: 'Aggro' },
      cards: [{ name: 'Lightning Bolt', quantity: 4 }],
    })
    // Lower-cased on purpose: the primer reference must resolve to the cache's
    // canonical spelling, or it warms a name the payload will never ask for.
    await fs.writeFile(primerSidecarPath(deckPath), 'Cast [[lightning bolt]], then [[Shock]].')

    const run = await runWarm()

    expect(run.names).toEqual(['Lightning Bolt', 'Shock'])
  })

  test('warms changelog references for flat lists, which their payloads also serve', async () => {
    await writeCollectionFile(workspace.dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
    await fs.writeFile(
      path.join(workspace.dir, 'collections', 'binder.changes.md'),
      [
        '# Changelog for Binder',
        '',
        '## 2026-01-01T00:00:00.000Z',
        '',
        '- Removed "Mana Crypt" &2',
        '',
      ].join('\n'),
    )

    const run = await runWarm()

    // 'Mana Crypt' is gone from the list but still rendered in its change history.
    expect(run.names).toEqual(['Mana Crypt', 'Sol Ring'])
  })

  test('reports the cache as ready once it holds cards, and offers tags when they are missing', async () => {
    await seedLists()
    await cardCache.set('Sol Ring', [makeScryfallCard({ name: 'Sol Ring' })])

    const run = await runWarm({ hasTags: async () => false })

    expect(run.warmth.ready).toBe(true)
    expect(run.tagCalls).toBe(1)
  })

  test('offers nothing to tag when the cache is empty', async () => {
    await seedLists()

    // An empty cache is a different problem (the caller warns about it);
    // offering to tag nothing would only bury it.
    const run = await runWarm({ hasTags: async () => false })

    expect(run.warmth.ready).toBe(false)
    expect(run.tagCalls).toBe(0)
  })

  test('threads a bulk download through to the price gate, which then has nothing to offer', async () => {
    await seedLists()
    const sawJustRefreshed: boolean[] = []

    await runWarm({
      ensureCards: async () => true,
      offerPrices: async (_names, cacheJustRefreshed) => {
        sawJustRefreshed.push(cacheJustRefreshed)
      },
    })

    expect(sawJustRefreshed).toEqual([true])
  })

  test('warming writes nothing to the workspace', async () => {
    await seedLists()
    const before = await snapshotTree(workspace.dir)

    await runWarm()

    // The fixtures carry `&N` ids; a warm that re-serialized a list would
    // rewrite card lines on a path that is only supposed to read them.
    expect(await snapshotTree(workspace.dir)).toEqual(before)
  })

  test('an empty workspace warms nothing rather than failing', async () => {
    const run = await runWarm()

    expect(run.names).toEqual([])
    expect(run.warmth.siteCardCount).toBe(0)
    expect(run.priceCalls).toBe(1)
  })
})

/**
 * The buylist half of the same startup: `serve --api` and `admin` both read
 * `site.sellMode` (or the `--sell-mode` session override) from the config
 * rather than being told, which is the one branch the unit tests cannot reach
 * — they all inject `sellMode`.
 */
describe('warmCardKingdomFeed config gate (Integration)', () => {
  let workspace: BoundWorkspace

  beforeEach(async () => {
    workspace = await bindWorkspace()
  })

  afterEach(async () => {
    await workspace.dispose()
  })

  /** No deps at all reach the network in this describe; make that structural. */
  const noNet = { http: new DenyHttpClient() }

  test.each([
    ['a workspace that never asked for sell mode', undefined],
    ['sell mode disabled in config', false],
  ])('%s warms nothing', async (_label, sellMode) => {
    if (sellMode !== undefined) await writeConfig(workspace.dir, { site: { sellMode } })

    // No `sellMode` argument: the config is the only thing that can say no,
    // and saying no is what keeps a ~70 MB download off an unrelated server.
    const warmth = await warmCardKingdomFeed('auto', {
      ...noNet,
      load: async () => {
        throw new Error('the cache must not be read when sell mode is off')
      },
    })

    expect(warmth).toStrictEqual({ enabled: false, ready: false, refreshed: false })
  })

  test('an explicit sellMode beats the config', async () => {
    await writeConfig(workspace.dir, { site: { sellMode: false } })

    // The injection seam a caller with its own policy uses. The commands
    // themselves reach the same outcome through the session override that
    // `--sell-mode` sets, which this call bypasses entirely.
    const warmth = await warmCardKingdomFeed('never', { ...noNet, sellMode: true })

    expect(warmth).toStrictEqual({ enabled: true, ready: false, refreshed: false })
  })

  test('a buylist that exists but cannot be read is left alone, not redownloaded', async () => {
    await writeConfig(workspace.dir, { site: { sellMode: true } })
    await fs.mkdir(path.join(workspace.dir, 'cache'), { recursive: true })
    await fs.writeFile(path.join(workspace.dir, 'cache', 'cardkingdom.json'), '{ not json')

    // The whole chain: a corrupt file loads as null, so the warm treats it the
    // way it treats an absent one — no prompt, and no ~70 MB download. `ask` is
    // the mode whose missing-feed branch would otherwise prompt.
    const warmth = await warmCardKingdomFeed('ask', noNet)

    expect(warmth).toStrictEqual({ enabled: true, ready: false, refreshed: false })
  })

  test('a config-enabled workspace with no buylist refuses the first download, even under auto', async () => {
    await writeConfig(workspace.dir, { site: { sellMode: true } })

    // `auto` is the mode that *would* download a missing feed on the CLI. A
    // server start must not spend ~70 MB, so the refusal here is a decision
    // rather than a structural impossibility — the `DenyHttpClient` is what
    // makes a regression fail loudly instead of quietly downloading.
    const warmth = await warmCardKingdomFeed('auto', noNet)

    expect(warmth).toStrictEqual({ enabled: true, ready: false, refreshed: false })
  })
})
