import { describe, test, expect } from 'bun:test'
import {
  appBootScript,
  localeDirection,
  renderAppShell,
  RTL_LANGUAGES,
} from '../../../src/site/html-shell'
import { localeTag } from '../../../src/i18n/locale-tag'
import type { LocaleTag } from '../../../src/i18n/types'

/**
 * The one shell both SPAs are served from. The properties that matter are the
 * ones a template literal in two unrelated files kept getting wrong: the
 * document's language and direction, and the bootstrap being a file rather than
 * an inline script the admin's own CSP blocks.
 */
describe('renderAppShell', () => {
  test('stamps lang and direction, and loads the bootstrap externally', () => {
    const html = renderAppShell({ lang: localeTag('en'), title: 'Ritual', initialTheme: 'default' })
    expect(html).toContain('<html lang="en" dir="ltr">')
    expect(html).toContain('<script src="boot.js"></script>')
    // The admin sets `script-src 'self'`; an inline script here was blocked.
    expect(html).not.toMatch(/<script>[^<]/)
  })

  // `localeDirection` is unit-tested on its own below; this pins that the shell
  // actually calls it rather than hardcoding `ltr` — a regression that would stay
  // invisible until an RTL locale shipped.
  test('stamps dir="rtl" for a right-to-left language', () => {
    expect(
      renderAppShell({ lang: localeTag('ar'), title: 'T', initialTheme: 'default' }),
    ).toContain('<html lang="ar" dir="rtl">')
  })

  test('emits data-theme only for a non-default theme', () => {
    expect(
      renderAppShell({ lang: localeTag('en'), title: 'T', initialTheme: 'default' }),
    ).toContain('<html lang="en" dir="ltr">')
    expect(renderAppShell({ lang: localeTag('en'), title: 'T', initialTheme: 'izzet' })).toContain(
      '<html lang="en" dir="ltr" data-theme="izzet">',
    )
  })

  test('refuses to interpolate a value that could break out of an attribute', () => {
    const html = renderAppShell({
      // Cast rather than minted: `parseLocaleTag` would reject this outright, and
      // the point of the case is the shell's own second line of defense.
      lang: 'en" onload="x' as unknown as LocaleTag,
      title: 'T',
      initialTheme: 'izzet" onload="x',
    })
    expect(html).toContain('<html lang="en" dir="ltr">')
    expect(html).not.toContain('onload')
  })

  test('escapes the title rather than trusting it', () => {
    const html = renderAppShell({
      lang: localeTag('en'),
      title: '<script>alert(1)</script>',
      initialTheme: 'default',
    })
    expect(html).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>')
  })

  test('appends extra head markup verbatim, for the dev live-reload client', () => {
    const html = renderAppShell({
      lang: localeTag('en'),
      title: 'Ritual Admin',
      initialTheme: 'default',
      extraHead: '\n  <script src="__dev_reload.js"></script>',
    })
    expect(html).toContain('<script src="__dev_reload.js"></script>')
  })
})

describe('localeDirection', () => {
  test('answers rtl for right-to-left languages, including regional tags', () => {
    expect(localeDirection('ar')).toBe('rtl')
    expect(localeDirection('he-IL')).toBe('rtl')
    expect(localeDirection('fa')).toBe('rtl')
  })

  test('answers ltr for everything else, and for anything it cannot parse', () => {
    expect(localeDirection('en')).toBe('ltr')
    expect(localeDirection('de-AT')).toBe('ltr')
    expect(localeDirection('ja')).toBe('ltr')
    expect(localeDirection('not a tag')).toBe('ltr')
  })
})

describe('appBootScript', () => {
  test('carries both bootstraps, since both must run before first paint', () => {
    expect(appBootScript).toContain('ritual:theme')
    expect(appBootScript).toContain('ritual:locale')
    expect(appBootScript).toContain('__ritualLocale__')
  })

  /**
   * The bootstrap runs before any module loads, so it restates the RTL rule as a
   * literal regex. It is *generated* from the same set `localeDirection` reads —
   * this pins that, because a hand-copied list would silently stamp `dir="ltr"`
   * on the first paint of an RTL locale while the hydrated app said `rtl`.
   */
  test('its inline direction rule is generated from the same language set', () => {
    const match = /\/\^\(([^)]+)\)\(-\|\$\)\/i/.exec(appBootScript)
    expect(match).not.toBeNull()
    expect((match?.[1] ?? '').split('|')).toEqual([...RTL_LANGUAGES])
  })
})
