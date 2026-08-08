import { describe, test, expect } from 'bun:test'
import { localeChoices, localeEndonym } from '../../../src/site/LanguageSwitcher'
import { localeTag } from '../../../src/i18n/locale-tag'
import type { LocaleTag } from '../../../src/i18n/types'

// Only the switcher's pure naming helpers are exercised here: solid-js resolves
// to its server build under `bun test`, so the component itself (and the
// reactivity that makes a switch re-render) is pinned by the Playwright spec.
describe('localeEndonym', () => {
  test('names a locale in its own language, not the current one', () => {
    // ICU's own data, so the assertions are on the shape rather than on exact
    // orthography: what matters is that the name is *not* the English one.
    expect(localeEndonym(localeTag('de'))).toBe('Deutsch')
    // Lowercase on purpose: CLDR gives each language its own capitalization
    // convention, and French does not capitalize language names. The switcher
    // must not "fix" that.
    expect(localeEndonym(localeTag('fr'))).toBe('français')
    expect(localeEndonym(localeTag('ja'))).toBe('日本語')
  })

  test('names English "English"', () => {
    expect(localeEndonym(localeTag('en'))).toBe('English')
  })

  test('a private-use subtag still resolves through its base language', () => {
    // The pseudo-locale is exactly this shape and must still be listable in the
    // switcher. ICU resolves the `en` base and qualifies it with the subtag, so
    // the exact value is pinned — a change there is a change the switcher shows.
    expect(localeEndonym(localeTag('en-XA'))).toBe('English (Pseudo-Accents)')
  })

  test('returns the tag itself rather than throwing on a malformed one', () => {
    // Deliberately *not* minted through `localeTag`: this is the defense-in-depth
    // path for a tag that reached the switcher without being parsed, which the
    // branded `LocaleTag` is meant to make unreachable. The assertion is that it
    // degrades rather than throws.
    const unparsed = (raw: string): LocaleTag => raw as unknown as LocaleTag
    expect(localeEndonym(unparsed('not a tag'))).toBe('not a tag')
    expect(localeEndonym(unparsed(''))).toBe('')
  })
})

describe('localeChoices', () => {
  test('preserves the deployment order and pairs each tag with its endonym', () => {
    expect(localeChoices([localeTag('en'), localeTag('de')])).toEqual([
      { tag: localeTag('en'), endonym: 'English' },
      { tag: localeTag('de'), endonym: 'Deutsch' },
    ])
  })

  test('handles a single-locale deployment (the switcher hides itself at render)', () => {
    expect(localeChoices([localeTag('en')])).toEqual([{ tag: localeTag('en'), endonym: 'English' }])
  })
})
