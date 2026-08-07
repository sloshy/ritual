import { describe, expect, test } from 'bun:test'
import {
  cardPrintingKey,
  formatPrintingLabel,
  lookupPrintingCard,
  printingKey,
  printingLanguageKey,
} from '../../src/printing-key'
import { findPrinting } from '../../src/card-printing'
import { makeScryfallCard } from '../test-utils'

describe('printingKey', () => {
  test('lowercases the set code so entry-built and Scryfall-built keys compare equal', () => {
    // A hand-written `(LEA:161)` line and Scryfall's own lowercase `lea` are the
    // same printing; every producer/consumer pair in the codebase depends on it.
    expect(printingKey('LEA', '161')).toBe('lea:161')
    expect(printingKey('lea', '161')).toBe('lea:161')
  })

  test('lowercases the collector number too, so a line can find a differently-cased cache entry', () => {
    // The `cards` map is built from Scryfall's spelling and read by the markdown
    // line's, so a case-sensitive key would miss silently.
    expect(printingKey('mkm', '507A')).toBe(printingKey('mkm', '507a'))
    expect(printingKey('SLD', '123A')).toBe('sld:123a')
  })

  test('agrees with findPrinting, the other resolver of "is this the same printing"', () => {
    // These two must never disagree: findPrinting compares case-insensitively and
    // says so; a key that folded less would report "not found" for a hit.
    const card = makeScryfallCard({ set: 'mkm', collector_number: '507a' })
    expect(findPrinting([card], 'MKM', '507A')).toBe(card)
    expect(printingKey('MKM', '507A')).toBe(cardPrintingKey(card))
  })

  test('cardPrintingKey reads both halves off one resolved printing', () => {
    const card = makeScryfallCard({ set: 'MKM', collector_number: '42B' })
    expect(cardPrintingKey(card)).toBe('mkm:42b')
    expect(cardPrintingKey(card)).toBe(printingKey(card.set, card.collector_number))
  })
})

describe('lookupPrintingCard', () => {
  const pinned = makeScryfallCard({ id: 'lea', set: 'lea', collector_number: '161' })
  const representative = makeScryfallCard({ id: 'rep', set: 'm10', collector_number: '146' })

  test('resolves an unpinned line by name', () => {
    const cards = { 'Lightning Bolt': representative }
    expect(lookupPrintingCard(cards, { name: 'Lightning Bolt' })).toBe(representative)
  })

  test('resolves a pinned line by its printing, not the by-name representative', () => {
    const cards = { 'lea:161': pinned, 'Lightning Bolt': representative }
    expect(
      lookupPrintingCard(cards, { name: 'Lightning Bolt', set: 'LEA', collectorNumber: '161' }),
    ).toBe(pinned)
  })

  test('an explicit null means "this printing is not cached" and does not fall back', () => {
    // The site builders write null here and warn while doing it; the entry was
    // priced at 0. Falling through to the representative would show a different
    // printing's art and price, so the page total would exceed the baked total.
    const cards = { 'xxx:999': null, 'Lightning Bolt': representative }
    expect(
      lookupPrintingCard(cards, { name: 'Lightning Bolt', set: 'xxx', collectorNumber: '999' }),
    ).toBeNull()
  })

  test('an absent printing key falls back to the by-name representative', () => {
    // The admin loader only adds printings it holds, so absence means "no opinion"
    // rather than "looked and missing" — distinct from the null case above.
    const cards = { 'Lightning Bolt': representative }
    expect(
      lookupPrintingCard(cards, { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }),
    ).toBe(representative)
  })

  test('a line with only half a printing is treated as unpinned', () => {
    const cards = { 'Lightning Bolt': representative }
    expect(lookupPrintingCard(cards, { name: 'Lightning Bolt', set: 'lea' })).toBe(representative)
  })

  describe('per-language lookups', () => {
    const japanese = makeScryfallCard({ id: 'lea-ja', set: 'lea', collector_number: '161' })

    test('a non-en ref resolves through its @lang key first', () => {
      const cards = { 'lea:161': pinned, 'lea:161@ja': japanese, 'Lightning Bolt': representative }
      expect(
        lookupPrintingCard(cards, {
          name: 'Lightning Bolt',
          set: 'LEA',
          collectorNumber: '161',
          language: 'ja',
        }),
      ).toBe(japanese)
    })

    test('an absent @lang key falls through to the plain key (the default-language object)', () => {
      // The plain key still holds the printing's default object — prices and
      // images — so a [ja] line on an en-only bake resolves to it.
      const cards = { 'lea:161': pinned, 'Lightning Bolt': representative }
      expect(
        lookupPrintingCard(cards, {
          name: 'Lightning Bolt',
          set: 'lea',
          collectorNumber: '161',
          language: 'ja',
        }),
      ).toBe(pinned)
    })

    test('an explicit null at the @lang key does not fall through', () => {
      // Same explicit-null contract as the plain key: null records "looked for,
      // not cached", so falling through would substitute a different object.
      const cards = {
        'lea:161': pinned,
        'lea:161@ja': null,
        'Lightning Bolt': representative,
      }
      expect(
        lookupPrintingCard(cards, {
          name: 'Lightning Bolt',
          set: 'lea',
          collectorNumber: '161',
          language: 'ja',
        }),
      ).toBeNull()
    })

    test('an en (or absent) language never reads @lang keys', () => {
      // The plain key IS the en object's home; `lea:161@en` is never written.
      const cards = { 'lea:161': pinned, 'lea:161@ja': japanese }
      expect(
        lookupPrintingCard(cards, {
          name: 'Lightning Bolt',
          set: 'lea',
          collectorNumber: '161',
          language: 'en',
        }),
      ).toBe(pinned)
      expect(
        lookupPrintingCard(cards, { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }),
      ).toBe(pinned)
    })
  })
})

describe('printingLanguageKey', () => {
  test('appends @lang to the folded printing key', () => {
    expect(printingLanguageKey('LEA', '161', 'ja')).toBe('lea:161@ja')
    expect(printingLanguageKey('mkm', '507A', 'zhs')).toBe('mkm:507a@zhs')
  })
})

describe('formatPrintingLabel', () => {
  test('uppercases only the set code, keeping the collector number verbatim', () => {
    // Uppercasing a whole printingKey would also fold the collector number,
    // rendering `MKM:507A` where every other surface shows `MKM:507a`.
    expect(formatPrintingLabel('mkm', '507a')).toBe('MKM:507a')
    expect(formatPrintingLabel('MKM', '507a')).toBe('MKM:507a')
  })
})
