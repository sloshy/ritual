import { describe, expect, test } from 'bun:test'
import { cardPrintingKey, formatPrintingLabel, printingKey } from '../../src/printing-key'
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

describe('formatPrintingLabel', () => {
  test('uppercases only the set code, keeping the collector number verbatim', () => {
    // Uppercasing a whole printingKey would also fold the collector number,
    // rendering `MKM:507A` where every other surface shows `MKM:507a`.
    expect(formatPrintingLabel('mkm', '507a')).toBe('MKM:507a')
    expect(formatPrintingLabel('MKM', '507a')).toBe('MKM:507a')
  })
})
