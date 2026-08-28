import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../src/cache'
import { refreshRitualConfig, resetRitualConfigCache } from '../../src/config/ritual-config'
import { runBuildSite, type BuildSiteOptions } from '../../src/commands/build-site'
import { ExitCode } from '../../src/util/errors'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import { runCli } from './helpers/cli'
import { captureExitCode } from '../helpers/cli'
import { captureConsole } from '../helpers/capture'
import { bindWorkspace, withWorkspace, type BoundWorkspace } from '../helpers/workspace'

/**
 * Source selection and build integrity: a build that could not assemble what it
 * was asked for must say so in its exit code, and must never replace a working
 * published site with a broken one.
 */
describe('build-site sources (Integration)', () => {
  let ws: BoundWorkspace

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    createSyntheticWorkspace(ws.dir)
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  afterEach(async () => {
    await ws.dispose()
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  /** Run a build offline and report the exit code it set (0 when it set none). */
  async function build(options: BuildSiteOptions = {}): Promise<number> {
    return captureExitCode(() => runBuildSite({ refresh: 'never', ...options }))
  }

  const distDir = (): string => path.join(ws.dir, 'dist')

  test('a deck can be selected by its display name, not just its file name', async () => {
    // The file is `test-unset-commander.md`; the docs' examples (and the config
    // selection) speak display names, so the flag must accept both.
    expect(await build({ decks: ['Test Unset Commander'] })).toBe(0)
    const index = JSON.parse(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')) as {
      decks: { name: string }[]
    }
    expect(index.decks.map((d) => d.name)).toEqual(['Test Unset Commander'])
  }, 120_000)

  test('a named deck that does not exist fails the build and keeps the previous site', async () => {
    expect(await build()).toBe(0)
    const previous = await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')

    expect(await build({ decks: ['Nonexistent Deck'] })).toBe(ExitCode.RuntimeError)
    // The published site is untouched — not emptied, not half-written.
    expect(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')).toBe(previous)
  }, 120_000)

  test('a named deck that exists but cannot be read reports why, and keeps the site', async () => {
    // The distinction the resolver used to lose: this file is right there, so
    // "no deck named that" would send the user looking for the wrong problem.
    expect(await build()).toBe(0)
    const previous = await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')

    await fs.writeFile(path.join(ws.dir, 'decks', 'broken.md'), '---\nname: [broken\n---\n')

    const { result: code, lines } = await captureConsole(['error'], () =>
      build({ decks: ['broken'] }),
    )

    expect(code).toBe(ExitCode.RuntimeError)
    const output = lines.error.join('\n')
    expect(output).toContain("Failed to load deck 'broken'")
    expect(output).not.toContain('no deck named that')
    expect(output).toContain('The published site was left unchanged.')
    expect(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')).toBe(previous)
  }, 120_000)

  test('a discovered deck that cannot be read is reported, and the rest is published', async () => {
    // The silent case: under the default wildcard include this deck used to be
    // dropped during discovery, so nothing downstream could mention it and the
    // build exited 0 having quietly published a site missing a deck.
    await fs.writeFile(path.join(ws.dir, 'decks', 'broken.md'), '---\nname: [broken\n---\n')

    const { result: code, lines } = await captureConsole(['error'], () => build())

    // Reported and built around: a list the user did not name going bad is not
    // a reason to withhold the whole site.
    expect(code).toBe(0)
    const output = lines.error.join('\n')
    expect(output).toContain("Failed to load deck 'broken'")
    expect(output).toContain('The site was published without them.')

    const index = JSON.parse(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')) as {
      decks: { name: string }[]
    }
    expect(index.decks.map((d) => d.name)).not.toContain('broken')
    expect(index.decks.length).toBeGreaterThan(0)
  }, 120_000)

  test('a named deck URL that cannot be fetched fails the build from inside it', async () => {
    // The only named failure discovery cannot pre-empt: a URL has no file to
    // resolve, so it reaches `skipSource` mid-build. That is the path where the
    // scratch tree is discarded rather than published — distinct from the
    // named-but-missing case, which returns before the build starts.
    expect(await build()).toBe(0)
    const previous = await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')

    const { result: code, lines } = await captureConsole(['error'], () =>
      build({ decks: ['https://example.com/decks/not-a-service'] }),
    )

    expect(code).toBe(ExitCode.RuntimeError)
    const output = lines.error.join('\n')
    expect(output).toContain('https://example.com/decks/not-a-service')
    expect(output).toContain('The published site was left unchanged.')
    // The scratch-and-swap is what makes this true: the build ran, wrote a whole
    // tree, and none of it reached dist/.
    expect(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')).toBe(previous)
  }, 120_000)

  test('a config include entry matching nothing warns but still builds', async () => {
    const configPath = path.join(ws.dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    config.site = { includeDecks: ['Test Unset Commander', 'Renamed Away'] }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
    resetRitualConfigCache()
    await refreshRitualConfig()

    const { result: code, lines } = await captureConsole(['warn'], () => build())
    expect(code).toBe(0)

    expect(lines.warn.join('\n')).toContain('Renamed Away')
    expect(await Bun.file(path.join(distDir(), 'index.json')).exists()).toBeTrue()
  }, 120_000)

  test('custom art files are copied into the site, and a missing one only warns', async () => {
    await fs.mkdir(path.join(ws.dir, 'art', 'proxies'), { recursive: true })
    await fs.writeFile(path.join(ws.dir, 'art', 'proxies', 'bolt.png'), 'bolt-bytes')
    await fs.writeFile(
      path.join(ws.dir, 'decks', 'emberwild-aggro.art.json'),
      JSON.stringify({ '1': { file: 'proxies/bolt.png' }, '2': { file: 'gone.png' } }),
    )
    // A second list whose sidecar does not parse at all: the build must say so
    // and carry on, not fail and not silently publish a list with no art.
    await fs.writeFile(path.join(ws.dir, 'collections', 'test-binder.art.json'), '{ not json')

    const { result: code, lines } = await captureConsole(['warn'], () => build())
    expect(code).toBe(0)

    // Copied under its art-dir-relative path — the same path the baked value
    // and the live `/art/*` route name.
    expect(await Bun.file(path.join(distDir(), 'art', 'proxies', 'bolt.png')).text()).toBe(
      'bolt-bytes',
    )
    expect(lines.warn.join('\n')).toContain('gone.png')
    // The parse failure is a build warning too, naming what is wrong with it.
    expect(lines.warn.join('\n')).toContain('not valid JSON')
    expect(await Bun.file(path.join(distDir(), 'collections', 'test-binder.json')).exists()).toBe(
      true,
    )

    // The deck detail names the deployed file, and says nothing at all about
    // the one that is not there — that card falls back to its real art.
    const detail = JSON.parse(
      await fs.readFile(path.join(distDir(), 'decks', 'emberwild-aggro.json'), 'utf-8'),
    ) as { deck: { sections: { cards: { cardId?: number; customArt?: string }[] }[] } }
    const cards = detail.deck.sections.flatMap((section) => section.cards)
    expect(cards.find((card) => card.cardId === 1)?.customArt).toBe('art/proxies/bolt.png')
    expect(cards.find((card) => card.cardId === 2)).not.toHaveProperty('customArt')
  }, 120_000)

  test('a bare selection flag is a usage error, not a silent full build', async () => {
    // Built first, so the assertion distinguishes "refused before building" from
    // "built and produced nothing" — in a fresh workspace it could not.
    expect(await build()).toBe(0)
    const previous = await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')

    expect(await build({ decks: true })).toBe(ExitCode.UsageError)

    expect(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')).toBe(previous)
  }, 120_000)
})

describe('build-site CLI source handling (Integration)', () => {
  test('a bare --decks on the command line is a usage error', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['build-site', '--decks', '--refresh', 'never'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--decks requires at least one name')
    })
  })

  test('an empty workspace says what to do instead of failing on a missing decks/', async () => {
    await withWorkspace(
      async (dir) => {
        const result = await runCli(['build-site', '--refresh', 'never'], dir)
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('Nothing to build')
        expect(result.stderr).toContain('ritual new deck')
        // Not a raw ENOENT for the missing decks/ directory.
        expect(result.stderr).not.toContain('ENOENT')
      },
      { dirs: [], config: false },
    )
  })
})
