import { afterEach, describe, expect, test } from 'bun:test'
import {
  hasUsableExplicitLocale,
  type IgnoredLocale,
  type LocaleSource,
  initI18n,
  resetUiLocaleResolution,
  resolveUiLocale,
  type UiLocaleInput,
} from '../../../src/cli/locale'
import { localeTag } from '../../../src/i18n/locale-tag-message'
import { DEFAULT_LOCALE, loadDictionary, resetI18nRuntime } from '../../../src/i18n/runtime'
import { withWorkspace } from '../../helpers/workspace'

const PSEUDO = localeTag('en-XA')

/** The resolver's input with nothing set but the shipped locales. */
function input(overrides: Partial<UiLocaleInput>): UiLocaleInput {
  return { available: [DEFAULT_LOCALE, PSEUDO], ...overrides }
}

/** The `ignored` entry a malformed `de_DE` produces, from whichever tier supplied it. */
function malformedDeDe(source: LocaleSource): IgnoredLocale {
  return {
    source,
    value: 'de_DE',
    error: 'invalid UI locale: invalid locale tag: de_DE',
    errorKey: 'domain.config.uiLocaleMalformed',
    errorParams: {
      reason: { messageKey: 'errors.i18n.localeTag.invalid', messageParams: { value: 'de_DE' } },
    },
  }
}

/**
 * `--locale` and `RITUAL_LOCALE` are separate tiers. Only the argv pre-scan
 * ever resolves a malformed flag (its argParser refuses one before the
 * authoritative pass), and what it resolves is the language that refusal is
 * worded in — so a typo in the flag must not hide a valid variable.
 */
describe('resolveUiLocale: the flag and variable tiers', () => {
  test('the flag outranks the variable', () => {
    const resolution = resolveUiLocale(input({ flag: 'en-XA', env: 'de' }))
    expect(resolution).toMatchObject({ locale: 'en-XA', source: 'flag', ignored: [] })
  })

  test('a malformed flag falls through to a valid variable, recorded with its English reason', () => {
    const resolution = resolveUiLocale(input({ flag: 'de_DE', env: 'en-XA', config: 'fr' }))
    expect(resolution).toMatchObject({ locale: 'en-XA', source: 'env', requested: 'en-XA' })
    expect(resolution.ignored).toEqual([malformedDeDe('flag')])
  })

  test('with both unusable, a valid config wins', () => {
    const resolution = resolveUiLocale(input({ flag: 'de_DE', env: 'fr_FR', config: 'en-XA' }))
    expect(resolution).toMatchObject({ locale: 'en-XA', source: 'config' })
    expect(resolution.ignored.map((entry) => entry.source)).toEqual(['flag', 'env'])
  })

  test('below an unusable config, detection decides', () => {
    const resolution = resolveUiLocale(input({ flag: 'de_DE', config: 'de_DE', detected: 'en-XA' }))
    expect(resolution).toMatchObject({ locale: 'en-XA', source: 'detected', detected: 'en-XA' })
    expect(resolution.ignored).toEqual([malformedDeDe('flag'), malformedDeDe('config')])
  })

  test('English only when no tier names a usable locale, the flag still recorded', () => {
    const resolution = resolveUiLocale(input({ flag: 'de_DE' }))
    expect(resolution).toMatchObject({ locale: DEFAULT_LOCALE, source: 'default' })
    expect(resolution.ignored).toEqual([malformedDeDe('flag')])
  })

  test('a blank flag counts as unset rather than as an ignored value', () => {
    const resolution = resolveUiLocale(input({ flag: '  ', env: 'en-XA' }))
    expect(resolution).toMatchObject({ locale: 'en-XA', source: 'env', ignored: [] })
  })
})

/**
 * An explicit tier skips the OS probe (a subprocess on Windows and macOS), so a
 * value that will not win must not count as one — or a typo in `--locale` on a
 * machine whose only locale is the OS's would be refused in English.
 */
describe('OS detection under a malformed explicit locale', () => {
  afterEach(() => {
    resetI18nRuntime()
    resetUiLocaleResolution()
  })

  test('only a value that parses counts as explicit', () => {
    expect(hasUsableExplicitLocale(['de-DE', undefined])).toBe(true)
    expect(hasUsableExplicitLocale([undefined, 'en-XA'])).toBe(true)
    expect(hasUsableExplicitLocale(['de_DE', '  ', undefined])).toBe(false)
  })

  /** Run the pre-scan pass on macOS with `argv`, counting the OS probe's calls. */
  async function bootOnMacos(argv: string[]): Promise<number> {
    // A second shipped locale, so detection is worth probing at all.
    loadDictionary(PSEUDO, {})
    let probed = 0
    // An empty workspace as the base dir, so no `uiLocale` on disk counts as explicit.
    await withWorkspace(async (baseDir) => {
      initI18n({
        argv: ['bun', 'ritual', ...argv],
        env: { RITUAL_BASE_DIR: baseDir },
        platform: 'darwin',
        probes: {
          probeMacos: () => {
            probed += 1
            return undefined
          },
        },
      })
    })
    return probed
  }

  test('a malformed --locale still lets the OS be asked', async () => {
    expect(await bootOnMacos(['--locale', 'de_DE', 'lists'])).toBe(1)
  })

  test('a valid --locale skips the probe', async () => {
    expect(await bootOnMacos(['--locale', 'en-XA', 'lists'])).toBe(0)
  })
})
