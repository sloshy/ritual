import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getBaseDir, setBaseDir } from '../../src/base-dir'
import { cardCache } from '../../src/cache'
import { refreshRitualConfig, resetRitualConfigCache } from '../../src/ritual-config'
import { runBuildSite, type BuildSiteOptions } from '../../src/commands/build-site'
import { ExitCode } from '../../src/commands/scripting'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

/**
 * Source selection and build integrity: a build that could not assemble what it
 * was asked for must say so in its exit code, and must never replace a working
 * published site with a broken one.
 */
describe('build-site sources (Integration)', () => {
  let dir: string
  let originalBase: string
  let originalExitCode: typeof process.exitCode

  beforeEach(async () => {
    originalBase = getBaseDir()
    originalExitCode = process.exitCode
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-build-sources-'))
    createSyntheticWorkspace(dir)
    setBaseDir(dir)
    resetRitualConfigCache()
    await refreshRitualConfig()
    cardCache.invalidate()
  })

  afterEach(async () => {
    process.exitCode = originalExitCode
    setBaseDir(originalBase)
    resetRitualConfigCache()
    await refreshRitualConfig()
    cardCache.invalidate()
    await fs.rm(dir, { recursive: true, force: true })
  })

  /** Run a build offline and report the exit code it set (0 when it set none). */
  async function build(options: BuildSiteOptions = {}): Promise<number> {
    process.exitCode = 0
    await runBuildSite({ refresh: 'never', ...options })
    const code = process.exitCode
    process.exitCode = 0
    return typeof code === 'number' ? code : 0
  }

  const distDir = (): string => path.join(dir, 'dist')

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

    await fs.writeFile(path.join(dir, 'decks', 'broken.md'), '---\nname: [broken\n---\n')

    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => void errors.push(args.join(' '))
    let code: number
    try {
      code = await build({ decks: ['broken'] })
    } finally {
      console.error = originalError
    }

    expect(code).toBe(ExitCode.RuntimeError)
    const output = errors.join('\n')
    expect(output).toContain("Failed to load deck 'broken'")
    expect(output).not.toContain('no deck named that')
    expect(output).toContain('The published site was left unchanged.')
    expect(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')).toBe(previous)
  }, 120_000)

  test('a discovered deck that cannot be read is reported, and the rest is published', async () => {
    // The silent case: under the default wildcard include this deck used to be
    // dropped during discovery, so nothing downstream could mention it and the
    // build exited 0 having quietly published a site missing a deck.
    await fs.writeFile(path.join(dir, 'decks', 'broken.md'), '---\nname: [broken\n---\n')

    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => void errors.push(args.join(' '))
    let code: number
    try {
      code = await build()
    } finally {
      console.error = originalError
    }

    // Reported and built around: a list the user did not name going bad is not
    // a reason to withhold the whole site.
    expect(code).toBe(0)
    const output = errors.join('\n')
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

    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => void errors.push(args.join(' '))
    let code: number
    try {
      code = await build({ decks: ['https://example.com/decks/not-a-service'] })
    } finally {
      console.error = originalError
    }

    expect(code).toBe(ExitCode.RuntimeError)
    const output = errors.join('\n')
    expect(output).toContain('https://example.com/decks/not-a-service')
    expect(output).toContain('The published site was left unchanged.')
    // The scratch-and-swap is what makes this true: the build ran, wrote a whole
    // tree, and none of it reached dist/.
    expect(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')).toBe(previous)
  }, 120_000)

  test('a config include entry matching nothing warns but still builds', async () => {
    const configPath = path.join(dir, 'ritual.config.json')
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    config.site = { includeDecks: ['Test Unset Commander', 'Renamed Away'] }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2))
    resetRitualConfigCache()
    await refreshRitualConfig()

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '))
    try {
      expect(await build()).toBe(0)
    } finally {
      console.warn = originalWarn
    }

    expect(warnings.join('\n')).toContain('Renamed Away')
    expect(await Bun.file(path.join(distDir(), 'index.json')).exists()).toBeTrue()
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
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-empty-'))
    try {
      const result = await runCli(['build-site', '--refresh', 'never'], dir)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Nothing to build')
      expect(result.stderr).toContain('ritual new deck')
      // Not a raw ENOENT for the missing decks/ directory.
      expect(result.stderr).not.toContain('ENOENT')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
