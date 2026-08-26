import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getBaseDir, setBaseDir } from '../../src/config/base-dir'
import { cardCache } from '../../src/cache'
import {
  getRitualConfigPath,
  refreshRitualConfig,
  resetRitualConfigCache,
} from '../../src/config/ritual-config'
import { runBuildSite, type BuildSiteOptions } from '../../src/commands/build-site'
import { ExitCode } from '../../src/util/errors'
import { startSiteServer } from '../../src/serve/server'
import type { StaticSiteServer } from '../../src/serve/static'
import { createSyntheticWorkspace } from '../e2e/helpers/synthetic-workspace'
import type { SiteIndex } from '../../src/list/site-data'
import { localeTag } from '../../src/i18n/locale-tag'
import { captureExitCode, runCli } from './helpers/cli'

/**
 * Locale plumbing through the site pipeline: which dictionaries a build
 * publishes, what the shell is stamped with, and what a live `serve --api`
 * reports. Catalog validation, tag parsing and browser precedence are pinned at
 * the unit layer; this covers the wiring only — flags, files on disk, and the
 * index payload.
 *
 * The dictionaries here are synthetic: `--locale-file` is exactly the seam a
 * released binary uses to mint a locale it was not built with, so the tests
 * mint one too rather than depending on whatever `RITUAL_BUNDLED_LOCALES` baked.
 */
describe('site locales (Integration)', () => {
  let dir: string
  let originalBase: string
  /** A synthetic dictionary, named for its tag the way the loader expects. */
  let localeFile: string

  const PSEUDO = localeTag('en-XA')
  const PSEUDO_CATALOG: Record<string, string> = {
    'site.toolbar.sortLabel': '[Şǿřŧ ƀẏ~~~]',
    'site.toolbar.sheetSort': '[Şḗȧřƈħ~~~]',
  }

  beforeEach(async () => {
    originalBase = getBaseDir()
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-site-locales-'))
    createSyntheticWorkspace(dir)
    setBaseDir(dir)
    resetRitualConfigCache()
    await refreshRitualConfig()
    cardCache.invalidate()
    localeFile = path.join(dir, `${PSEUDO}.json`)
    await fs.writeFile(localeFile, JSON.stringify(PSEUDO_CATALOG))
  })

  afterEach(async () => {
    setBaseDir(originalBase)
    resetRitualConfigCache()
    await refreshRitualConfig()
    cardCache.invalidate()
    await fs.rm(dir, { recursive: true, force: true })
  })

  /** Run a build offline and report the exit code it set (0 when it set none). */
  async function build(options: BuildSiteOptions = {}): Promise<number> {
    return captureExitCode(() => runBuildSite({ refresh: 'never', ...options }))
  }

  const distDir = (): string => path.join(dir, 'dist')

  async function readIndex(): Promise<SiteIndex> {
    return JSON.parse(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')) as SiteIndex
  }

  test('publishes the requested dictionaries and lists them in index.json', async () => {
    expect(await build({ locales: ['en', PSEUDO], localeFile: [localeFile] })).toBe(0)

    const emitted = await fs.readdir(path.join(distDir(), 'locales'))
    expect(emitted.sort()).toEqual(['en-XA.json', 'en.json'])
    // The file on disk is the dictionary the browser fetches, verbatim.
    const pseudo = JSON.parse(
      await fs.readFile(path.join(distDir(), 'locales', `${PSEUDO}.json`), 'utf-8'),
    ) as Record<string, string>
    expect(pseudo['site.toolbar.sortLabel']).toBe(PSEUDO_CATALOG['site.toolbar.sortLabel'])

    const index = await readIndex()
    expect(index.availableLocales).toEqual([localeTag('en'), PSEUDO])
    // English is the baked default until --locale says otherwise.
    expect(index.uiLocale).toBe(localeTag('en'))
  }, 120_000)

  test('a default build publishes English only, so no switcher appears', async () => {
    expect(await build()).toBe(0)
    expect(await fs.readdir(path.join(distDir(), 'locales'))).toEqual(['en.json'])
    expect((await readIndex()).availableLocales).toEqual([localeTag('en')])
  }, 120_000)

  test('--locale stamps the shell and the index, and the bootstrap stays external', async () => {
    expect(await build({ locale: PSEUDO, localeFile: [localeFile] })).toBe(0)

    const html = await fs.readFile(path.join(distDir(), 'index.html'), 'utf-8')
    expect(html).toContain(`<html lang="${PSEUDO}" dir="ltr">`)
    // The CSP fix: no inline script may survive in either shell, and the file
    // it points at has to be published alongside it.
    expect(html).toContain('<script src="boot.js"></script>')
    expect(html).not.toMatch(/<script>[^<]/)
    const boot = await fs.readFile(path.join(distDir(), 'boot.js'), 'utf-8')
    expect(boot).toContain('ritual:theme')
    expect(boot).toContain('ritual:locale')

    const index = await readIndex()
    expect(index.uiLocale).toBe(PSEUDO)
    // Naming a locale implies publishing its dictionary — a shell that says
    // `lang="en-XA"` must be able to fetch what it names.
    expect(index.availableLocales).toEqual([localeTag('en'), PSEUDO])
  }, 120_000)

  test('the real CLI wires --locale through to the build, from either position', async () => {
    // Not a duplicate of the in-process case above: `--locale` is declared on
    // the root program *and* on `build-site`, and commander gives the root the
    // value from either position. Nothing that calls `runBuildSite` directly
    // can catch that flag being dropped on the floor — only a spawned binary.
    for (const args of [
      ['build-site', '--locale', PSEUDO],
      ['--locale', PSEUDO, 'build-site'],
    ]) {
      await fs.rm(distDir(), { recursive: true, force: true })
      const result = await runCli(
        [...args, '--locale-file', localeFile, '--refresh', 'never'],
        dir,
        { RITUAL_BASE_DIR: dir },
      )
      expect(result.exitCode).toBe(0)

      const html = await fs.readFile(path.join(distDir(), 'index.html'), 'utf-8')
      expect(html).toContain(`<html lang="${PSEUDO}" dir="ltr">`)
      expect((await readIndex()).uiLocale).toBe(PSEUDO)
    }
  }, 180_000)

  test('--locales rejects a tag no dictionary exists for', async () => {
    expect(await build({ locales: ['de-AT'] })).toBe(ExitCode.UsageError)
    // Refused before anything was written: no dist/ at all, not an empty one.
    expect(await fs.readdir(distDir()).catch(() => null)).toBeNull()
  }, 120_000)

  test('a malformed --locale-file fails the build and leaves the previous site published', async () => {
    expect(await build({ locales: ['en', PSEUDO], localeFile: [localeFile] })).toBe(0)
    const previous = await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')

    const broken = path.join(dir, 'de-AT.json')
    await fs.writeFile(broken, '{ "site.toolbar.sortLabel": ')
    expect(await build({ localeFile: [broken] })).toBe(ExitCode.RuntimeError)

    // Untouched: not emptied, not half-written, not stripped of its locales.
    expect(await fs.readFile(path.join(distDir(), 'index.json'), 'utf-8')).toBe(previous)
    expect((await fs.readdir(path.join(distDir(), 'locales'))).sort()).toEqual([
      'en-XA.json',
      'en.json',
    ])
  }, 120_000)

  test('a locale file whose value is not a message shape is refused by name', async () => {
    const broken = path.join(dir, 'de-AT.json')
    await fs.writeFile(broken, JSON.stringify({ 'site.toolbar.sortLabel': ['Sortieren'] }))
    expect(await build({ localeFile: [broken] })).toBe(ExitCode.RuntimeError)
  }, 120_000)

  describe('serve --api', () => {
    let server: StaticSiteServer
    let base: string

    beforeEach(async () => {
      expect(await build({ locales: ['en', PSEUDO], localeFile: [localeFile] })).toBe(0)
      server = startSiteServer({ port: 0, hostname: '127.0.0.1', distDir: distDir() })
      base = `http://127.0.0.1:${server.port}`
    })

    afterEach(async () => {
      await server.stop(true)
    })

    test('serves the published dictionaries, and 404s anything else', async () => {
      const pseudo = await fetch(`${base}/locales/${PSEUDO}.json`)
      expect(pseudo.status).toBe(200)
      expect(pseudo.headers.get('Content-Type')).toContain('application/json')
      expect(await pseudo.json()).toEqual(PSEUDO_CATALOG)

      expect((await fetch(`${base}/locales/de-AT.json`)).status).toBe(404)
      expect((await fetch(`${base}/locales/..%2F..%2Fritual.config.json`)).status).toBe(404)
    })

    test('a config set of uiLocale is reflected without a restart', async () => {
      const before = (await (await fetch(`${base}/index.json`)).json()) as SiteIndex
      expect(before.uiLocale).toBe(localeTag('en'))
      // What the live index knows about the languages it can serve comes from
      // the published tree, not from what this binary happens to carry.
      expect(before.availableLocales).toEqual([localeTag('en'), PSEUDO])

      // The regression this guards: `uiLocale` has to be part of the config
      // stamp the live index memoizes on, or a `config set` stays invisible
      // until some unrelated file's mtime moves.
      await fs.writeFile(getRitualConfigPath(), JSON.stringify({ uiLocale: PSEUDO }))
      try {
        const after = (await (await fetch(`${base}/index.json`)).json()) as SiteIndex
        expect(after.uiLocale).toBe(PSEUDO)
      } finally {
        await fs.rm(getRitualConfigPath(), { force: true })
      }
    })
  })
})
