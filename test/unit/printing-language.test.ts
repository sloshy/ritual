import { describe, expect, test } from 'bun:test'
import { resolvePrintingLanguage } from '../../src/card/printing-language'
import { makePrintingIn as printing } from '../test-utils'

describe('resolvePrintingLanguage', () => {
  test('returns the preferred language when the printing is available in it', () => {
    const printings = [printing('ltc', '284'), printing('ltc', '284', 'ja')]
    expect(resolvePrintingLanguage(printings, 'ltc', '284', 'ja')).toEqual({
      language: 'ja',
      honoredPreferred: true,
    })
  })

  test('falls back to en when the printing exists but not in the preferred language', () => {
    const printings = [printing('ltc', '284'), printing('ltc', '284', 'de')]
    expect(resolvePrintingLanguage(printings, 'ltc', '284', 'ja')).toEqual({
      language: 'en',
      honoredPreferred: false,
    })
  })

  test('a card object with no lang field counts as English availability', () => {
    const printings = [printing('ltc', '284')]
    expect(resolvePrintingLanguage(printings, 'ltc', '284', 'ja')).toEqual({
      language: 'en',
      honoredPreferred: false,
    })
  })

  test('returns the only available language when neither preferred nor en exists', () => {
    const printings = [printing('sta', '63', 'ja')]
    expect(resolvePrintingLanguage(printings, 'sta', '63', 'de')).toEqual({
      language: 'ja',
      honoredPreferred: false,
    })
  })

  test('a preferred foreign language beats canonical order when both are available', () => {
    // de sits before ja in CARD_LANGUAGES, but the picker tiebreak is
    // "preferred first, canonical order only among the leftovers".
    const printings = [printing('sta', '63', 'de'), printing('sta', '63', 'ja')]
    expect(resolvePrintingLanguage(printings, 'sta', '63', 'ja')).toEqual({
      language: 'ja',
      honoredPreferred: true,
    })
  })

  test('several foreign-only languages resolve to the first in canonical order', () => {
    // Canonical CARD_LANGUAGES order lists de before ja.
    const printings = [printing('sta', '63', 'ja'), printing('sta', '63', 'de')]
    expect(resolvePrintingLanguage(printings, 'sta', '63', 'fr')).toEqual({
      language: 'de',
      honoredPreferred: false,
    })
  })

  test('honors the preferred language when availability is unknowable (printing not cached)', () => {
    const honored = { language: 'ja', honoredPreferred: true } as const
    expect(resolvePrintingLanguage([], 'ltc', '284', 'ja')).toEqual(honored)
    expect(resolvePrintingLanguage(undefined, 'ltc', '284', 'ja')).toEqual(honored)
    // Printings exist for the name, but none for this set:cn — still unknowable.
    const other = [printing('c19', '221')]
    expect(resolvePrintingLanguage(other, 'ltc', '284', 'ja')).toEqual(honored)
  })

  test('matches the printing case-insensitively', () => {
    const printings = [printing('ltc', '284A', 'ja')]
    expect(resolvePrintingLanguage(printings, 'LTC', '284a', 'ja')).toEqual({
      language: 'ja',
      honoredPreferred: true,
    })
  })

  test('an English preference answers en whatever else is available', () => {
    expect(resolvePrintingLanguage([printing('ltc', '284')], 'ltc', '284', 'en')).toEqual({
      language: 'en',
      honoredPreferred: true,
    })
    expect(resolvePrintingLanguage([], 'ltc', '284', 'en')).toEqual({
      language: 'en',
      honoredPreferred: true,
    })
    // Even against a foreign-only printing: en is unavailable, so the only
    // available language wins — the one branch where an en preference bends,
    // and the notice surfaces see honoredPreferred: false.
    expect(resolvePrintingLanguage([printing('sta', '63', 'ja')], 'sta', '63', 'en')).toEqual({
      language: 'ja',
      honoredPreferred: false,
    })
  })
})
