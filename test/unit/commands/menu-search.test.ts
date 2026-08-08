import { afterEach, describe, expect, test } from 'bun:test'

import {
  choiceSearchAliases,
  matchesChoiceTerms,
  matchesChoiceTitleTerms,
  type SearchableChoice,
} from '../../../src/commands/menu-search'
import { resetI18nRuntime, setLocale } from '../../../src/i18n/runtime'
import { localeTag } from '../../../src/i18n/locale-tag'

/**
 * The two things translating a menu breaks, both of which are invisible until a
 * user tries to type: the English terms that used to select a row, and the
 * assumption that a query is delimited by spaces at all.
 */

function row(title: string, searchAliases?: string[]): SearchableChoice {
  return searchAliases === undefined
    ? { title, value: title }
    : { title, value: title, searchAliases }
}

afterEach(() => {
  resetI18nRuntime()
})

describe('choiceSearchAliases', () => {
  test('reads the aliases a menu row carries', () => {
    expect(choiceSearchAliases(row('終了', ['Exit']))).toEqual(['Exit'])
  })

  test('a plain card choice has none', () => {
    expect(choiceSearchAliases(row('Sol Ring'))).toEqual([])
  })
})

describe('matchesChoiceTerms', () => {
  test('matches on the title, every term in any order', () => {
    expect(matchesChoiceTerms(row('💾 Save all changes'), 'save changes')).toBe(true)
    expect(matchesChoiceTerms(row('💾 Save all changes'), 'save exit')).toBe(false)
  })

  test('matches on an English alias when the title no longer contains the term', () => {
    const translated = row('💾 すべての変更を保存', ['Save all changes'])
    expect(matchesChoiceTerms(translated, 'save all')).toBe(true)
  })

  test('an alias only widens the row it belongs to', () => {
    expect(matchesChoiceTerms(row('Sol Ring'), 'save')).toBe(false)
  })

  test('punctuation in the query is ignored, as it is for card names', () => {
    expect(matchesChoiceTerms(row("Jace's Archivist"), 'jaces archivist')).toBe(true)
  })
})

describe('matchesChoiceTitleTerms', () => {
  test('keeps punctuation significant, unlike the card-name matcher', () => {
    // The list pickers title their rows with file names, where a hyphen or an
    // apostrophe is part of the identity rather than noise.
    expect(matchesChoiceTitleTerms(row("Jace's Archivist"), "jace's")).toBe(true)
    expect(matchesChoiceTitleTerms(row('Jaces Archivist'), "jace's")).toBe(false)
  })

  test('still consults the English aliases', () => {
    expect(matchesChoiceTitleTerms(row('🚪 終了', ['Exit']), 'exit')).toBe(true)
  })
})

describe('unsegmented scripts', () => {
  test('a Japanese query matches only the rows that contain its words', () => {
    // Both matchers strip everything outside [a-z0-9 ], so without segmentation
    // this query normalizes to the empty string and matches every row — which
    // is worse than matching none, because the menu looks unfiltered.
    setLocale(localeTag('ja'))
    const menu = [row('リストを切り替える'), row('セッションの変更を表示'), row('終了')]
    const matched = menu.filter((choice) => matchesChoiceTerms(choice, 'リスト切り替える'))
    expect(matched.map((choice) => choice.title)).toEqual(['リストを切り替える'])
  })

  test('a single-word query still filters rather than matching everything', () => {
    setLocale(localeTag('ja'))
    const menu = [row('リストを切り替える'), row('終了')]
    expect(menu.filter((choice) => matchesChoiceTerms(choice, '終了')).length).toBe(1)
  })

  test('a Latin query never takes the segmented path', () => {
    // The guard that keeps this from changing any existing behavior: `c19`
    // must not start matching a title holding `c` and `19` separately.
    expect(matchesChoiceTerms(row('C 19 Precon'), 'c19')).toBe(false)
    expect(matchesChoiceTerms(row('C19 Precon'), 'c19')).toBe(true)
  })

  test('an empty query matches everything, as before', () => {
    expect(matchesChoiceTerms(row('Sol Ring'), '')).toBe(true)
  })
})
