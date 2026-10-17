import { describe, expect, test } from 'bun:test'
import {
  CK_CSV_MAX_CARDS,
  CK_CSV_MAX_TITLES,
  type CartWarning,
  type CartWarningCode,
} from '../../src/buylist/cart-csv'
import {
  CART_WARNING_KEYS,
  cartWarningMessage,
  cartWarningRef,
  renderCartWarning,
} from '../../src/buylist/cart-message'
import { keyedMessage } from '../helpers/api-message'
import {
  expectLocaleInForce,
  foreignLocales,
  pseudoCatalog,
  withSyntheticLocale,
} from '../helpers/sync-text'

/**
 * The sell-cart builder returns codes (it is fenced: its file is CK's import
 * format); this is where they become words. Pinned here: each code's key, its
 * English byte for byte as the builder wrote it before its text became codes,
 * English on the wire in any UI language, and the reader's language on the
 * CLI and the sites with CK's own titles untouched.
 */

type CartWarningOf<C extends CartWarningCode> = Extract<CartWarning, { code: C }>

/**
 * One warning per code, with its full English — a missing row, or a row whose
 * warning has another code, is a compile error, so no code goes unpinned.
 */
const WARNINGS: { [C in CartWarningCode]: [CartWarningOf<C>, string] } = {
  // Three titles: a German `unit` list joins its last pair with "und", so a
  // reader in another language is told apart from English by the join too.
  'etched-as-foil': [
    {
      code: 'etched-as-foil',
      params: { titles: ['Sol Ring', 'Arcane Signet (Retro Frame)', 'Command Tower'] },
    },
    'The CK CSV format cannot mark etched foils; exported as foil — adjust in the sell cart: ' +
      'Sol Ring, Arcane Signet (Retro Frame), Command Tower',
  ],
  'too-many-titles': [
    { code: 'too-many-titles', params: { count: 501, max: CK_CSV_MAX_TITLES } },
    'CK imports at most 500 unique titles per upload (this file has 501); split it before uploading.',
  ],
  'too-many-cards': [
    { code: 'too-many-cards', params: { count: 5001, max: CK_CSV_MAX_CARDS } },
    'CK imports at most 5000 cards per upload (this file has 5001); split it before uploading.',
  ],
}

describe('every cart warning code', () => {
  test('is worded by its own key', () => {
    expect(CART_WARNING_KEYS).toEqual({
      'etched-as-foil': 'domain.buylist.cart.etchedAsFoil',
      'too-many-titles': 'domain.buylist.cart.tooManyTitles',
      'too-many-cards': 'domain.buylist.cart.tooManyCards',
    })
  })

  test('the etched titles travel as a unit list, unrendered', () => {
    const [etched] = WARNINGS['etched-as-foil']
    expect(cartWarningRef(etched)).toEqual({
      messageKey: 'domain.buylist.cart.etchedAsFoil',
      messageParams: {
        titles: {
          list: ['Sol Ring', 'Arcane Signet (Retro Frame)', 'Command Tower'],
          join: 'unit',
        },
      },
    })
  })

  test.each(Object.entries(WARNINGS))(
    '%s renders its English, keyed',
    (code, [warning, english]) => {
      // The row is the code it is filed under, so a copy-pasted row cannot pin
      // one code's English under another's name.
      expect<string>(warning.code).toBe(code)
      const message = cartWarningMessage(warning)
      expect(message.messageKey).toBe(CART_WARNING_KEYS[warning.code])
      expect(keyedMessage(message)).toBe(english)
    },
  )

  test.each(foreignLocales())(
    'every warning stays English on the wire under $tag',
    ({ tag, catalog }) => {
      withSyntheticLocale(tag, catalog, (locale) => {
        expectLocaleInForce(locale)
        for (const [warning, english] of Object.values(WARNINGS)) {
          expect(cartWarningMessage(warning).message).toBe(english)
        }
        expectLocaleInForce(locale)
      })
    },
  )
})

describe('the reader’s language', () => {
  test('a warning renders translated, CK’s titles and the figures untouched', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      for (const [warning, english] of Object.values(WARNINGS)) {
        expect(renderCartWarning(warning)).not.toBe(english)
      }
      const [etched] = WARNINGS['etched-as-foil']
      expect(renderCartWarning(etched)).toContain('Arcane Signet (Retro Frame)')
      const [titles] = WARNINGS['too-many-titles']
      expect(renderCartWarning(titles)).toContain('501')
    })
  })

  test('the etched titles join as the reader’s language lists things', () => {
    withSyntheticLocale('de', {}, (locale) => {
      expectLocaleInForce(locale)
      const [etched] = WARNINGS['etched-as-foil']
      expect(renderCartWarning(etched)).toEndWith(
        'Sol Ring, Arcane Signet (Retro Frame) und Command Tower',
      )
    })
  })
})
