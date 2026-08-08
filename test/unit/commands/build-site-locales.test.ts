import { describe, test, expect } from 'bun:test'
import { Command } from 'commander'
import {
  parseLocaleFile,
  planLocales,
  resolveBuildLocale,
  type BuildLocale,
  type BuildSiteOptions,
} from '../../../src/commands/build-site'
import { localeTag } from '../../../src/i18n/locale-tag'

/**
 * The `--locale` / `--locales` / `--locale-file` semantics, at the layer that
 * can express them. `test/integration/site-locales.test.ts` covers one path
 * through the real build; everything about *which* locale wins and which
 * dictionaries ship is decided here.
 */

const PSEUDO: BuildLocale = {
  tag: localeTag('en-XA'),
  catalog: { 'site.toolbar.sortLabel': '[Şǿřŧ ƀẏ~~~]' },
}
const GERMAN: BuildLocale = {
  tag: localeTag('de-AT'),
  catalog: { 'site.toolbar.sortLabel': 'Sortieren nach' },
}

describe('planLocales', () => {
  test('defaults to English only, from the configured locale', () => {
    const plan = planLocales({
      locale: undefined,
      locales: undefined,
      configured: localeTag('en'),
      available: [PSEUDO],
    })
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.locale).toBe(localeTag('en'))
    expect(plan.emitted.map((entry) => entry.tag)).toEqual([localeTag('en')])
    expect(plan.warnings).toEqual([])
  })

  test('the configured uiLocale is the baked default when no flag names one', () => {
    const plan = planLocales({
      locale: undefined,
      locales: undefined,
      configured: localeTag('en-XA'),
      available: [PSEUDO],
    })
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.locale).toBe(localeTag('en-XA'))
    // Naming a locale implies emitting it: the shell says `lang="en-XA"`, so
    // the dictionary it names has to be fetchable.
    expect(plan.emitted.map((entry) => entry.tag)).toEqual([localeTag('en'), localeTag('en-XA')])
  })

  test('--locale beats the configured value and is canonicalized', () => {
    const plan = planLocales({
      locale: 'de-at',
      locales: undefined,
      configured: localeTag('en-XA'),
      available: [PSEUDO, GERMAN],
    })
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.locale).toBe(localeTag('de-AT'))
    expect(plan.emitted.map((entry) => entry.tag)).toEqual([localeTag('en'), localeTag('de-AT')])
  })

  test('--locales all emits every dictionary this build has', () => {
    const plan = planLocales({
      locale: undefined,
      locales: ['all'],
      configured: localeTag('en'),
      available: [PSEUDO, GERMAN],
    })
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.emitted.map((entry) => entry.tag)).toEqual([
      localeTag('en'),
      localeTag('en-XA'),
      localeTag('de-AT'),
    ])
  })

  test('English is always emitted and never duplicated', () => {
    const plan = planLocales({
      locale: 'en',
      locales: ['en', 'en', 'en-XA'],
      configured: localeTag('en'),
      available: [PSEUDO],
    })
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.emitted.map((entry) => entry.tag)).toEqual([localeTag('en'), localeTag('en-XA')])
  })

  test('a baked locale with no dictionary warns rather than failing', () => {
    // Zero coverage is the degenerate case of partial coverage, and partial
    // locales have to stay shippable — the site renders English under the tag.
    const plan = planLocales({
      locale: 'de-AT',
      locales: undefined,
      configured: localeTag('en'),
      available: [PSEUDO],
    })
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.locale).toBe(localeTag('de-AT'))
    expect(plan.emitted.map((entry) => entry.tag)).toEqual([localeTag('en')])
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toContain('de-AT')
  })

  test('--locales naming a dictionary that does not exist is a usage error', () => {
    const plan = planLocales({
      locale: undefined,
      locales: ['de-AT'],
      configured: localeTag('en'),
      available: [PSEUDO],
    })
    expect(typeof plan).toBe('string')
    expect(plan).toContain('--locale-file')
  })

  test('an unparseable tag is reported, from either flag', () => {
    expect(
      planLocales({
        locale: 'zz-ZZ',
        locales: undefined,
        configured: localeTag('en'),
        available: [],
      }),
    ).toContain('--locale')
    expect(
      planLocales({
        locale: undefined,
        locales: ['nope'],
        configured: localeTag('en'),
        available: [],
      }),
    ).toContain('--locales')
  })

  test('a dictionary loaded from disk overrides a baked one for the same tag', () => {
    const baked: BuildLocale = {
      tag: localeTag('en-XA'),
      catalog: { 'site.toolbar.sortLabel': 'baked' },
    }
    const fromDisk: BuildLocale = {
      tag: localeTag('en-XA'),
      catalog: { 'site.toolbar.sortLabel': 'from disk' },
    }
    const plan = planLocales({
      locale: undefined,
      locales: ['en-XA'],
      configured: localeTag('en'),
      available: [baked, fromDisk],
    })
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.emitted[1]?.catalog['site.toolbar.sortLabel']).toBe('from disk')
  })
})

describe('parseLocaleFile', () => {
  test('accepts strings, plural tables and select tables', () => {
    const parsed = parseLocaleFile(
      JSON.stringify({
        'site.toolbar.sortLabel': 'Sortieren nach',
        'domain.count.copies': { $plural: 'count', one: '{count} Kopie', other: '{count} Kopien' },
      }),
    )
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed['site.toolbar.sortLabel']).toBe('Sortieren nach')
    expect(parsed['domain.count.copies']).toEqual({
      $plural: 'count',
      one: '{count} Kopie',
      other: '{count} Kopien',
    })
  })

  test('drops keys the English catalog does not have, so a stale file still ships', () => {
    const parsed = parseLocaleFile(
      JSON.stringify({ 'site.toolbar.sortLabel': 'Sortieren nach', 'site.gone.away': 'weg' }),
    )
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(Object.keys(parsed)).toEqual(['site.toolbar.sortLabel'])
  })

  test('reports malformed JSON, a non-object document, and a bad value by key', () => {
    expect(parseLocaleFile('{')).toContain('not valid JSON')
    expect(parseLocaleFile('["a"]')).toContain('JSON object')
    expect(parseLocaleFile(JSON.stringify({ 'site.toolbar.sortLabel': 3 }))).toContain(
      'site.toolbar.sortLabel',
    )
    expect(parseLocaleFile(JSON.stringify({ 'site.toolbar.sortLabel': {} }))).toContain(
      'discriminator',
    )
    expect(
      parseLocaleFile(
        JSON.stringify({
          'domain.count.copies': { $select: 'kind', deck: { $plural: 'count', other: 'x' } },
        }),
      ),
    ).toContain('split the key')
  })
})

/**
 * `--locale` is declared on the root program *and* on the build surface, and
 * commander hands the root the value from either position — so the build's own
 * declaration never receives one and `options.locale` is always undefined.
 *
 * This pins the commander behavior the fix depends on, not just the fix: if a
 * commander upgrade ever gives the subcommand its own value, the first two
 * cases still pass and the third proves the resolver reads the right one.
 */
describe('resolveBuildLocale', () => {
  /**
   * A command tree the same shape as the real one: a root that declares
   * `--locale` (the CLI's own language) and a subcommand that declares it too
   * (the locale baked into the site).
   */
  function resolveFrom(argv: readonly string[]): string | undefined {
    let seen: string | undefined
    const program = new Command()
    program.name('ritual').exitOverride()
    program.option('--locale <tag>', 'CLI locale')
    const build = program.command('build-site').option('--locale <tag>', 'site locale')
    build.action((options: BuildSiteOptions) => {
      seen = resolveBuildLocale(build, options)
    })
    program.parse(['node', 'ritual', ...argv])
    return seen
  }

  test('reads the flag typed after the subcommand, which the root consumes', () => {
    expect(resolveFrom(['build-site', '--locale', 'de-AT'])).toBe('de-AT')
  })

  test('reads the flag typed before the subcommand', () => {
    expect(resolveFrom(['--locale', 'de-AT', 'build-site'])).toBe('de-AT')
  })

  test('is undefined when no flag names one, so the configured uiLocale wins', () => {
    expect(resolveFrom(['build-site'])).toBeUndefined()
  })
})
