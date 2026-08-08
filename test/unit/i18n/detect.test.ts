import { describe, expect, test } from 'bun:test'
import { localeTag } from '../../../src/i18n/locale-tag'
import type { LocaleTag } from '../../../src/i18n/types'
import {
  detectOsLocale,
  detectPosixLocale,
  MACOS_PROBE_COMMAND,
  normalizePosixLocale,
  probeOsLocale,
  WINDOWS_PROBE_COMMAND,
  type LocaleEnv,
  type LocaleProbe,
  type LocaleProbeSource,
} from '../../../src/i18n/detect'

type NormalizeCase = {
  name: string
  input: string
  expected: LocaleTag | undefined
}

// Every case is table-driven and the environment is injected, so these assert
// what Ritual detects — never what the machine running the suite happens to be
// set to.
describe('normalizePosixLocale', () => {
  const cases: NormalizeCase[] = [
    { name: 'language and region', input: 'de_DE', expected: localeTag('de-DE') },
    { name: 'strips the codeset', input: 'de_DE.UTF-8', expected: localeTag('de-DE') },
    { name: 'strips a non-UTF codeset', input: 'zh_CN.GB18030', expected: localeTag('zh-CN') },
    {
      name: 'maps @latin to a script subtag',
      input: 'sr_RS@latin',
      expected: localeTag('sr-Latn-RS'),
    },
    {
      name: 'maps @cyrillic to a script subtag',
      input: 'sr_RS@cyrillic',
      expected: localeTag('sr-Cyrl-RS'),
    },
    {
      name: 'drops an unknown modifier',
      input: 'ca_ES.UTF-8@valencia',
      expected: localeTag('ca-ES'),
    },
    { name: 'language only', input: 'ja', expected: localeTag('ja') },
    { name: 'canonicalizes region case', input: 'pt_br', expected: localeTag('pt-BR') },
    { name: 'accepts an already-BCP-47 value', input: 'de-AT', expected: localeTag('de-AT') },
    // The single most important case: `C.UTF-8` is the default in most
    // containers, and reading it as a language would mean detecting English for
    // a user who has set no locale at all.
    { name: 'rejects C', input: 'C', expected: undefined },
    { name: 'rejects POSIX', input: 'POSIX', expected: undefined },
    { name: 'rejects C.UTF-8', input: 'C.UTF-8', expected: undefined },
    { name: 'rejects the empty string', input: '', expected: undefined },
    { name: 'rejects whitespace', input: '   ', expected: undefined },
    { name: 'rejects structural garbage', input: '!!!', expected: undefined },
    { name: 'rejects a locale with spaces', input: 'not a locale', expected: undefined },
  ]

  for (const { name, input, expected } of cases) {
    test(name, () => {
      expect(normalizePosixLocale(input)).toBe(expected)
    })
  }
})

describe('detectPosixLocale precedence', () => {
  type PrecedenceCase = {
    name: string
    env: LocaleEnv
    expected: LocaleTag | undefined
  }

  const cases: PrecedenceCase[] = [
    {
      name: 'LC_ALL beats everything',
      env: { LC_ALL: 'fr_FR.UTF-8', LC_MESSAGES: 'de_DE', LANGUAGE: 'ja', LANG: 'es_ES' },
      expected: localeTag('fr-FR'),
    },
    {
      name: 'LC_MESSAGES beats LANGUAGE and LANG',
      env: { LC_MESSAGES: 'de_DE.UTF-8', LANGUAGE: 'ja', LANG: 'es_ES' },
      expected: localeTag('de-DE'),
    },
    {
      name: 'LANGUAGE beats LANG',
      env: { LANGUAGE: 'ja', LANG: 'es_ES.UTF-8' },
      expected: localeTag('ja'),
    },
    {
      name: 'LANGUAGE is a colon-separated priority list',
      env: { LANGUAGE: 'ja:de', LANG: 'es_ES.UTF-8' },
      expected: localeTag('ja'),
    },
    {
      name: 'an unusable LANGUAGE entry falls through to the next entry',
      env: { LANGUAGE: 'C:de_AT', LANG: 'es_ES.UTF-8' },
      expected: localeTag('de-AT'),
    },
    {
      name: 'LANG is the last resort',
      env: { LANG: 'es_ES.UTF-8' },
      expected: localeTag('es-ES'),
    },
    {
      // GNU gettext ignores LANGUAGE entirely when the effective locale is
      // C/POSIX: a user who asked for the C locale asked for untranslated output.
      name: 'LANGUAGE is suppressed when the effective locale is C',
      env: { LANG: 'C.UTF-8', LANGUAGE: 'ja:de' },
      expected: undefined,
    },
    {
      name: 'LANGUAGE is suppressed when LC_ALL is C',
      env: { LC_ALL: 'C', LANGUAGE: 'ja:de' },
      expected: undefined,
    },
    {
      // LC_ALL=C names no language, so the chain keeps walking rather than
      // pinning English — but LANGUAGE stays suppressed.
      name: 'a C value falls through to the next usable source',
      env: { LC_ALL: 'C', LANGUAGE: 'ja', LANG: 'de_DE.UTF-8' },
      expected: localeTag('de-DE'),
    },
    {
      name: 'blank values count as unset',
      env: { LC_ALL: '', LC_MESSAGES: '   ', LANG: 'de_DE.UTF-8' },
      expected: localeTag('de-DE'),
    },
    {
      name: 'an empty environment yields no signal',
      env: {},
      expected: undefined,
    },
    {
      name: 'garbage yields no signal',
      env: { LANG: '!!!' },
      expected: undefined,
    },
  ]

  for (const { name, env, expected } of cases) {
    test(name, () => {
      expect(detectPosixLocale(env)).toBe(expected)
    })
  }
})

describe('detectOsLocale', () => {
  test('the POSIX chain runs first on every platform', () => {
    const probeWindows = () => 'fr-CA'
    expect(
      detectOsLocale({
        platform: 'win32',
        env: { LANG: 'de_DE.UTF-8' },
        bundledLocaleCount: 3,
        probeWindows,
      }),
    ).toBe(localeTag('de-DE'))
  })

  test('non-Windows platforms never probe', () => {
    let probed = false
    const result = detectOsLocale({
      platform: 'linux',
      env: {},
      bundledLocaleCount: 3,
      probeWindows: () => {
        probed = true
        return 'fr-CA'
      },
    })
    expect(result).toBeUndefined()
    expect(probed).toBe(false)
  })

  test('Windows probes when nothing explicit was requested and several locales ship', () => {
    expect(
      detectOsLocale({
        platform: 'win32',
        env: {},
        bundledLocaleCount: 2,
        probeWindows: () => 'fr-CA',
      }),
    ).toBe(localeTag('fr-CA'))
  })

  test('an English-only build never pays for the probe', () => {
    let probed = false
    const result = detectOsLocale({
      platform: 'win32',
      env: {},
      bundledLocaleCount: 1,
      probeWindows: () => {
        probed = true
        return 'fr-CA'
      },
    })
    expect(result).toBeUndefined()
    expect(probed).toBe(false)
  })

  test('an explicit locale at a higher tier suppresses the probe', () => {
    let probed = false
    const result = detectOsLocale({
      platform: 'win32',
      env: {},
      hasExplicitLocale: true,
      bundledLocaleCount: 3,
      probeWindows: () => {
        probed = true
        return 'fr-CA'
      },
    })
    expect(result).toBeUndefined()
    expect(probed).toBe(false)
  })

  test('an unusable probe result is discarded rather than trusted', () => {
    expect(
      detectOsLocale({
        platform: 'win32',
        env: {},
        bundledLocaleCount: 3,
        probeWindows: () => 'Invariant Language (Invariant Country)',
      }),
    ).toBeUndefined()
  })

  test('macOS probes under the same gate as Windows', () => {
    expect(
      detectOsLocale({
        platform: 'darwin',
        env: {},
        bundledLocaleCount: 2,
        probeMacos: () => 'de_DE',
      }),
    ).toBe(localeTag('de-DE'))
  })

  test('an English-only build never pays for the macOS probe either', () => {
    let probed = false
    const result = detectOsLocale({
      platform: 'darwin',
      env: {},
      bundledLocaleCount: 1,
      probeMacos: () => {
        probed = true
        return 'de_DE'
      },
    })
    expect(result).toBeUndefined()
    expect(probed).toBe(false)
  })

  test('the macOS probe never runs on Windows, nor the Windows probe on macOS', () => {
    const ran: string[] = []
    detectOsLocale({
      platform: 'darwin',
      env: {},
      bundledLocaleCount: 2,
      probeWindows: () => {
        ran.push('windows')
        return 'fr-CA'
      },
      probeMacos: () => {
        ran.push('macos')
        return 'de_DE'
      },
    })
    expect(ran).toEqual(['macos'])
  })
})

/**
 * `probeOsLocale` is the opt-in path behind `ritual locale --detect`: it runs
 * every applicable source and reports what each said. Both subprocess probes
 * are injected here — the suite must never spawn `powershell` or `defaults`.
 */
describe('probeOsLocale', () => {
  function probeFor(probes: readonly LocaleProbe[], source: LocaleProbeSource): LocaleProbe {
    const found = probes.find((probe) => probe.source === source)
    if (found === undefined) throw new Error(`no ${source} probe in the report`)
    return found
  }

  test('reports the environment variable that supplied the value', () => {
    const report = probeOsLocale({
      platform: 'linux',
      env: { LANGUAGE: 'ja', LANG: 'es_ES.UTF-8' },
    })

    expect(report.tag).toBe(localeTag('ja'))
    expect(probeFor(report.probes, 'environment')).toEqual({
      source: 'environment',
      ran: true,
      origin: 'LANGUAGE',
      raw: 'ja',
      tag: localeTag('ja'),
    })
  })

  test('a set-but-unusable environment value is reported as found, not as absent', () => {
    const report = probeOsLocale({ platform: 'linux', env: { LANG: 'C.UTF-8' } })

    expect(report.tag).toBeUndefined()
    expect(probeFor(report.probes, 'environment')).toEqual({
      source: 'environment',
      ran: true,
      origin: 'LANG',
      raw: 'C.UTF-8',
    })
  })

  test('an empty environment names the whole chain it consulted', () => {
    const report = probeOsLocale({ platform: 'linux', env: {} })

    expect(probeFor(report.probes, 'environment')).toEqual({
      source: 'environment',
      ran: true,
      origin: 'LC_ALL, LC_MESSAGES, LANGUAGE, LANG',
    })
  })

  test('probes belonging to another platform are reported as skipped, never omitted', () => {
    let probed = false
    const report = probeOsLocale({
      platform: 'linux',
      env: {},
      probeWindows: () => {
        probed = true
        return 'fr-CA'
      },
      probeMacos: () => {
        probed = true
        return 'de_DE'
      },
    })

    expect(probed).toBe(false)
    expect(report.probes.map((probe) => probe.source)).toEqual(['environment', 'windows', 'macos'])
    expect(probeFor(report.probes, 'windows').ran).toBe(false)
    expect(probeFor(report.probes, 'macos').ran).toBe(false)
  })

  test('the Windows probe runs on Windows and carries the command it spawned', () => {
    const report = probeOsLocale({
      platform: 'win32',
      env: {},
      probeWindows: () => 'fr-CA',
      probeMacos: () => 'de_DE',
    })

    expect(report.tag).toBe(localeTag('fr-CA'))
    const windows = probeFor(report.probes, 'windows')
    expect(windows.ran).toBe(true)
    expect(windows.raw).toBe('fr-CA')
    expect(windows.tag).toBe(localeTag('fr-CA'))
    expect(windows.origin).toBe(WINDOWS_PROBE_COMMAND)
    expect(probeFor(report.probes, 'macos').ran).toBe(false)
  })

  test('the macOS probe runs on macOS and normalizes its POSIX-shaped answer', () => {
    const report = probeOsLocale({ platform: 'darwin', env: {}, probeMacos: () => 'de_DE' })

    expect(report.tag).toBe(localeTag('de-DE'))
    const macos = probeFor(report.probes, 'macos')
    expect(macos.ran).toBe(true)
    expect(macos.raw).toBe('de_DE')
    expect(macos.origin).toBe(MACOS_PROBE_COMMAND)
  })

  test('a probe that answers nothing is reported as having run', () => {
    const report = probeOsLocale({ platform: 'win32', env: {}, probeWindows: () => undefined })

    expect(report.tag).toBeUndefined()
    expect(probeFor(report.probes, 'windows')).toEqual({
      source: 'windows',
      ran: true,
      origin: WINDOWS_PROBE_COMMAND,
    })
  })

  test('an unusable probe answer is reported raw, with no tag', () => {
    const report = probeOsLocale({
      platform: 'win32',
      env: {},
      probeWindows: () => 'Invariant Language (Invariant Country)',
    })

    expect(report.tag).toBeUndefined()
    const windows = probeFor(report.probes, 'windows')
    expect(windows.raw).toBe('Invariant Language (Invariant Country)')
    expect(windows.tag).toBeUndefined()
  })

  // Unlike the gated hot path, the flag exists precisely to say what *each*
  // source thinks — so a decided environment must not suppress the probe.
  test('the platform probe still runs when the environment already decided', () => {
    const report = probeOsLocale({
      platform: 'darwin',
      env: { LANG: 'es_ES.UTF-8' },
      probeMacos: () => 'de_DE',
    })

    expect(report.tag).toBe(localeTag('es-ES'))
    expect(probeFor(report.probes, 'macos')).toMatchObject({
      ran: true,
      raw: 'de_DE',
      tag: localeTag('de-DE'),
    })
  })
})
