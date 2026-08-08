import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level.
import '../../src/scryfall'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Command } from 'commander'
import { registerCacheCommand } from '../../src/commands/cache'
import { CARDKINGDOM_PRICELIST_URL, loadCardKingdomCache } from '../../src/cardkingdom'
import { cardCache } from '../../src/cache'
import { runCli, withTempDir } from './helpers/cli'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
import { stubScryfallBulk } from './helpers/scryfall-bulk'
import type { StubbedFetch } from './helpers/stub-fetch'
import { bulkCard, cardKingdomFeedBody, makeCardKingdomProduct } from '../test-utils'

/**
 * `ritual cache preload-all` flag validation. Only the offline-safe usage path
 * is pinned at the CLI layer: a real preload downloads the full Scryfall bulk
 * (or needs a live feed), so the engine's source resolution and its
 * failure-to-exit-1 mapping stay covered by the refreshCardCache unit tests
 * (test/unit/cache-refresh-source.test.ts) instead of a network-dependent run.
 */
describe('cache preload-all CLI (Integration)', () => {
  test('--source scryfall with --url is a usage error', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(
        ['cache', 'preload-all', '--source', 'scryfall', '--url', 'https://feed.example/feed.json'],
        dir,
      )

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("--url only applies when the cache source is 'feed'")
    })
  })
})

/**
 * "Updating the caches" includes the buyer feed under sell mode — a site built
 * from a day-old buylist bakes yesterday's offers. Only an in-process run can
 * stub both downloads, so the command is driven through commander against a
 * stubbed `fetch` that serves the Scryfall bulk files and the pricelist.
 */
describe('cache preload-all buylist step (Integration)', () => {
  let workspace: BoundWorkspace | undefined
  let stubbed: StubbedFetch | undefined
  let warnings: string[]
  const originalWarn = console.warn

  /** Run the subcommand, returning the exit code it set and restoring the process's. */
  async function runPreloadAll(): Promise<number> {
    const originalExitCode = process.exitCode
    process.exitCode = 0
    const program = new Command()
    registerCacheCommand(program)
    // `console.warn` stays captured until the afterEach restores it, so a test
    // that runs this twice records both runs rather than only the first.
    await program.parseAsync(['cache', 'preload-all'], { from: 'user' })
    const code = process.exitCode
    process.exitCode = originalExitCode
    return typeof code === 'number' ? code : 0
  }

  /** Whether the run asked Card Kingdom for its pricelist. */
  const downloadedFeed = (): boolean =>
    (stubbed?.sent ?? []).some((request) => request.url.startsWith(CARDKINGDOM_PRICELIST_URL))

  beforeEach(() => {
    warnings = []
    workspace = undefined
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '))
  })

  afterEach(async () => {
    console.warn = originalWarn
    stubbed?.restore()
    stubbed = undefined
    // Optional: each test binds its own workspace inside its body, so a bind
    // that threw must not be reported here as a confusing `undefined` error
    // instead of the real failure.
    await workspace?.dispose()
    workspace = undefined
  })

  test('sell mode in the config pulls the buyer feed alongside the card cache', async () => {
    workspace = await bindWorkspace({
      config: { site: { sellMode: true } },
      init: true,
      clearCardCache: true,
    })
    stubbed = stubScryfallBulk({
      cards: [bulkCard()],
      routes: {
        [CARDKINGDOM_PRICELIST_URL]: () =>
          Response.json(
            cardKingdomFeedBody([makeCardKingdomProduct({ id: 5, name: 'Sol Ring', priceBuy: 3 })]),
          ),
      },
    })

    const code = await runPreloadAll()

    expect(code).toBe(0)
    expect(await cardCache.get('Sol Ring')).not.toBeNull()
    const feed = await loadCardKingdomCache()
    expect(feed?.feed.products).toHaveLength(1)
    expect(feed?.feed.products[0]).toMatchObject({ id: 5, priceBuy: 3 })
  })

  test('a default workspace refreshes the card cache and nothing else', async () => {
    workspace = await bindWorkspace({ init: true, clearCardCache: true })
    stubbed = stubScryfallBulk({ cards: [bulkCard()] })

    const code = await runPreloadAll()

    expect(code).toBe(0)
    expect(await cardCache.get('Sol Ring')).not.toBeNull()
    // Sell mode is off, so nothing may spend ~70 MB on a capability this
    // workspace never asked for. The stub fails an unrouted request loudly, so
    // the absence is checked on the record rather than on a missing file alone.
    expect(downloadedFeed()).toBe(false)
    expect(
      await fs
        .stat(path.join(workspace.dir, 'cache', 'cardkingdom.json'))
        .then(() => true)
        .catch(() => false),
    ).toBe(false)
  })

  test('a failed buylist download warns instead of failing the command', async () => {
    workspace = await bindWorkspace({
      config: { site: { sellMode: true } },
      init: true,
      clearCardCache: true,
    })
    stubbed = stubScryfallBulk({
      cards: [bulkCard()],
      routes: { [CARDKINGDOM_PRICELIST_URL]: () => new Response('nope', { status: 500 }) },
    })

    const code = await runPreloadAll()

    // The card cache did refresh; reporting that as a failure would break every
    // script and cron job that checks this command's exit code.
    expect(code).toBe(0)
    expect(await cardCache.get('Sol Ring')).not.toBeNull()
    expect(downloadedFeed()).toBe(true)
    // A fragment unique to `cli.cache.preloadAllBuylistFailed`: matching on
    // "Card Kingdom" alone would pass for any of the ensure gate's own logs.
    expect(warnings.join('\n')).toContain('The card cache was updated, but')
    expect(warnings.join('\n')).toContain('HTTP 500')
  })
})
