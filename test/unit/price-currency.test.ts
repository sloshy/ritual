import { describe, test, expect } from 'bun:test'
import {
  isPriceCurrency,
  parsePriceCurrencyFlag,
  formatFinishPriceCell,
  formatPrice,
  formatPriceColumn,
  MAX_PRICE_COLUMN_LABEL,
  formatPriceOrNA,
  formatPriceWithMissing,
  formatPrintingFinishCell,
  printingFinishColumns,
  getCardPrice,
  getCardPriceForFinish,
  isCurrencyAvailableForCard,
  isFinishPricelessInCurrency,
  parseCurrenciesFlag,
} from '../../src/price-currency'
import type { ScryfallCard } from '../../src/types'
import { makeScryfallCard } from '../test-utils'

function makeCard(prices: Partial<ScryfallCard['prices']> = {}): ScryfallCard {
  return makeScryfallCard({ prices })
}

describe('isPriceCurrency', () => {
  test('accepts only the known currencies', () => {
    expect(isPriceCurrency('usd')).toBe(true)
    expect(isPriceCurrency('eur')).toBe(true)
    expect(isPriceCurrency('tix')).toBe(true)
    expect(isPriceCurrency('gbp')).toBe(false)
    expect(isPriceCurrency('')).toBe(false)
  })
})

describe('parsePriceCurrencyFlag', () => {
  test('defaults to usd when undefined', () => {
    expect(parsePriceCurrencyFlag(undefined)).toBe('usd')
  })

  test('uses the given fallback when undefined or empty', () => {
    expect(parsePriceCurrencyFlag(undefined, 'eur')).toBe('eur')
    expect(parsePriceCurrencyFlag('', 'tix')).toBe('tix')
    expect(parsePriceCurrencyFlag('usd', 'eur')).toBe('usd')
  })

  test('parses case-insensitively', () => {
    expect(parsePriceCurrencyFlag('USD')).toBe('usd')
    expect(parsePriceCurrencyFlag('usd')).toBe('usd')
    expect(parsePriceCurrencyFlag('Usd')).toBe('usd')
    expect(parsePriceCurrencyFlag('EUR')).toBe('eur')
    expect(parsePriceCurrencyFlag('eur')).toBe('eur')
    expect(parsePriceCurrencyFlag('Eur')).toBe('eur')
    expect(parsePriceCurrencyFlag('TIX')).toBe('tix')
    expect(parsePriceCurrencyFlag('tix')).toBe('tix')
    expect(parsePriceCurrencyFlag('Tix')).toBe('tix')
  })

  test('trims whitespace', () => {
    expect(parsePriceCurrencyFlag('  eur  ')).toBe('eur')
  })

  test('throws on invalid input', () => {
    expect(() => parsePriceCurrencyFlag('gbp')).toThrow(/Invalid price currency/)
    expect(() => parsePriceCurrencyFlag('jpy')).toThrow(/Invalid price currency/)
  })
})

describe('formatPrice', () => {
  test('formats usd with dollar sign', () => {
    expect(formatPrice(12.5, 'usd')).toBe('$12.50')
  })

  test('formats eur with euro sign', () => {
    expect(formatPrice(8, 'eur')).toBe('€8.00')
  })

  test('formats tix with suffix', () => {
    expect(formatPrice(3.25, 'tix')).toBe('3.25 tix')
  })

  test('formats zero', () => {
    expect(formatPrice(0, 'usd')).toBe('$0.00')
  })
})

describe('formatPriceWithMissing', () => {
  test('returns normal format when no cards are missing', () => {
    expect(formatPriceWithMissing(12.5, 'usd', 0)).toBe('$12.50')
  })

  test('returns "At least" format when cards are missing', () => {
    expect(formatPriceWithMissing(10.0, 'usd', 3)).toBe('At least $10.00 (missing 3 cards)')
    expect(formatPriceWithMissing(8.5, 'eur', 2)).toBe('At least €8.50 (missing 2 cards)')
    expect(formatPriceWithMissing(5.0, 'tix', 10)).toBe('At least 5.00 tix (missing 10 cards)')
  })

  test('uses singular "card" when only 1 is missing', () => {
    expect(formatPriceWithMissing(20.0, 'usd', 1)).toBe('At least $20.00 (missing 1 card)')
  })

  test('returns normal format for zero missing with tix', () => {
    expect(formatPriceWithMissing(3.25, 'tix', 0)).toBe('3.25 tix')
  })
})

describe('formatPriceOrNA', () => {
  test('returns formatted price for positive amounts', () => {
    expect(formatPriceOrNA(12.5, 'usd')).toBe('$12.50')
    expect(formatPriceOrNA(8, 'eur')).toBe('€8.00')
    expect(formatPriceOrNA(3.25, 'tix')).toBe('3.25 tix')
  })

  test('returns N/A for zero', () => {
    expect(formatPriceOrNA(0, 'usd')).toBe('N/A')
    expect(formatPriceOrNA(0, 'eur')).toBe('N/A')
    expect(formatPriceOrNA(0, 'tix')).toBe('N/A')
  })
})

describe('getCardPrice', () => {
  test('returns price per currency', () => {
    const card = makeCard({ usd: '12.50', eur: '9.99', tix: '3.00' })
    expect(getCardPrice(card, 'usd')).toBe(12.5)
    expect(getCardPrice(card, 'eur')).toBe(9.99)
    expect(getCardPrice(card, 'tix')).toBe(3)
  })

  test('returns 0 when price is null', () => {
    const card = makeCard()
    expect(getCardPrice(card, 'usd')).toBe(0)
    expect(getCardPrice(card, 'eur')).toBe(0)
    expect(getCardPrice(card, 'tix')).toBe(0)
  })
})

describe('getCardPriceForFinish', () => {
  test('returns nonfoil usd price by default', () => {
    const card = makeCard({ usd: '5.00', usd_foil: '10.00' })
    expect(getCardPriceForFinish(card, 'nonfoil', 'usd')).toBe(5)
  })

  test('returns foil usd price', () => {
    const card = makeCard({ usd: '5.00', usd_foil: '10.00' })
    expect(getCardPriceForFinish(card, 'foil', 'usd')).toBe(10)
  })

  test('returns etched usd price', () => {
    const card = makeCard({ usd_etched: '15.00' })
    expect(getCardPriceForFinish(card, 'etched', 'usd')).toBe(15)
  })

  test('returns eur nonfoil price', () => {
    const card = makeCard({ eur: '7.50' })
    expect(getCardPriceForFinish(card, 'nonfoil', 'eur')).toBe(7.5)
  })

  test('returns eur foil price', () => {
    const card = makeCard({ eur_foil: '20.00' })
    expect(getCardPriceForFinish(card, 'foil', 'eur')).toBe(20)
  })

  test('reports etched as unpriced in EUR rather than quoting the nonfoil price', () => {
    // Scryfall publishes no eur_etched field, so an etched card has no euro price
    // at all. Reading `eur` here would label the nonfoil price as the etched one.
    const card = makeCard({ eur: '7.50', eur_foil: '20.00', usd_etched: '15.00' })
    expect(getCardPriceForFinish(card, 'etched', 'eur')).toBe(0)
    // The finishes that do have EUR data are unaffected.
    expect(getCardPriceForFinish(card, 'nonfoil', 'eur')).toBe(7.5)
    expect(getCardPriceForFinish(card, 'foil', 'eur')).toBe(20)
    // USD has a real etched field, so etched prices normally there.
    expect(getCardPriceForFinish(card, 'etched', 'usd')).toBe(15)
  })

  test('returns tix price regardless of finish', () => {
    const card = makeCard({ tix: '2.50' })
    expect(getCardPriceForFinish(card, 'nonfoil', 'tix')).toBe(2.5)
    expect(getCardPriceForFinish(card, 'foil', 'tix')).toBe(2.5)
  })

  test('returns 0 when price is null', () => {
    const card = makeCard()
    expect(getCardPriceForFinish(card, 'nonfoil', 'usd')).toBe(0)
    expect(getCardPriceForFinish(card, 'foil', 'eur')).toBe(0)
    expect(getCardPriceForFinish(card, 'nonfoil', 'tix')).toBe(0)
  })
})

describe('isCurrencyAvailableForCard', () => {
  test('usd requires paper', () => {
    expect(isCurrencyAvailableForCard(['paper'], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard(['mtgo'], 'usd')).toBe(false)
    expect(isCurrencyAvailableForCard(['arena'], 'usd')).toBe(false)
  })

  test('eur requires paper', () => {
    expect(isCurrencyAvailableForCard(['paper'], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard(['mtgo'], 'eur')).toBe(false)
  })

  test('tix requires mtgo', () => {
    expect(isCurrencyAvailableForCard(['mtgo'], 'tix')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper'], 'tix')).toBe(false)
  })

  test('empty games array returns true (backward compat)', () => {
    expect(isCurrencyAvailableForCard([], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard([], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard([], 'tix')).toBe(true)
  })

  test('paper+mtgo supports all currencies', () => {
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'tix')).toBe(true)
  })
})

describe('parseCurrenciesFlag', () => {
  test('returns all currencies when undefined', () => {
    expect(parseCurrenciesFlag(undefined)).toEqual(['usd', 'eur', 'tix'])
  })

  test('parses single currency', () => {
    expect(parseCurrenciesFlag('eur')).toEqual(['eur'])
  })

  test('parses comma-separated currencies', () => {
    expect(parseCurrenciesFlag('usd,eur')).toEqual(['usd', 'eur'])
  })

  test('deduplicates currencies', () => {
    expect(parseCurrenciesFlag('usd,usd,eur')).toEqual(['usd', 'eur'])
  })

  test('is case insensitive', () => {
    expect(parseCurrenciesFlag('USD,EUR')).toEqual(['usd', 'eur'])
  })

  test('trims whitespace', () => {
    expect(parseCurrenciesFlag(' usd , tix ')).toEqual(['usd', 'tix'])
  })

  test('throws for invalid currency', () => {
    expect(() => parseCurrenciesFlag('usd,gbp')).toThrow()
  })

  test('returns all currencies for empty string (treated as no input)', () => {
    expect(parseCurrenciesFlag('')).toEqual(['usd', 'eur', 'tix'])
  })
})

describe('formatFinishPriceCell', () => {
  test('formats the given finish in the given currency', () => {
    const card = makeCard({ usd: '1.50', usd_foil: '4.25', eur: '1.10' })
    expect(formatFinishPriceCell(card, 'nonfoil', 'usd')).toBe('$1.50')
    expect(formatFinishPriceCell(card, 'foil', 'usd')).toBe('$4.25')
    expect(formatFinishPriceCell(card, 'nonfoil', 'eur')).toBe('\u20ac1.10')
  })

  test('is N/A for a finish the printing carries no price for', () => {
    expect(formatFinishPriceCell(makeCard(), 'foil', 'usd')).toBe('N/A')
  })

  test('is null for an unknown printing, so the picker shows no column', () => {
    expect(formatFinishPriceCell(undefined, 'foil', 'usd')).toBeNull()
  })
})

describe('printingFinishColumns', () => {
  const etchedOnly = makeScryfallCard({ finishes: ['etched'] })
  const nonfoilFoil = makeScryfallCard({ finishes: ['nonfoil', 'foil'] })

  test('lists every finish any printing is offered in, in canonical order', () => {
    expect(printingFinishColumns([etchedOnly, nonfoilFoil], 'usd')).toEqual([
      'nonfoil',
      'foil',
      'etched',
    ])
  })

  test('keeps a nonfoil-only list to a single column', () => {
    expect(printingFinishColumns([makeScryfallCard({ finishes: ['nonfoil'] })], 'usd')).toEqual([
      'nonfoil',
    ])
  })

  test('drops the etched column in EUR, which has no etched price to show', () => {
    expect(printingFinishColumns([etchedOnly, nonfoilFoil], 'eur')).toEqual(['nonfoil', 'foil'])
  })

  test('collapses to one column in tix, which prices every finish alike', () => {
    expect(printingFinishColumns([etchedOnly, nonfoilFoil], 'tix')).toEqual(['nonfoil'])
  })
})

describe('formatPrintingFinishCell', () => {
  test('quotes the nonfoil finish without a tag', () => {
    const card = makeScryfallCard({ finishes: ['nonfoil', 'foil'], prices: { usd: '2.00' } })
    expect(formatPrintingFinishCell(card, 'nonfoil', 'usd')).toBe('$2.00')
  })

  test('tags the foil and etched finishes so they do not read as nonfoil quotes', () => {
    const foil = makeScryfallCard({ finishes: ['nonfoil', 'foil'], prices: { usd_foil: '9.99' } })
    expect(formatPrintingFinishCell(foil, 'foil', 'usd')).toBe('$9.99 foil')
    const etched = makeScryfallCard({ finishes: ['etched'], prices: { usd_etched: '12.00' } })
    expect(formatPrintingFinishCell(etched, 'etched', 'usd')).toBe('$12.00 etched')
  })

  test('keeps the finish tag when the printing has no price at all', () => {
    const etchedOnly = makeScryfallCard({ finishes: ['etched'] })
    expect(formatPrintingFinishCell(etchedOnly, 'etched', 'usd')).toBe('N/A etched')
  })

  test('is null for a finish the printing is not offered in', () => {
    const nonfoilOnly = makeScryfallCard({ finishes: ['nonfoil'], prices: { usd: '2.00' } })
    expect(formatPrintingFinishCell(nonfoilOnly, 'foil', 'usd')).toBeNull()
  })

  test("quotes a foil-only printing in tix's single untagged column", () => {
    const foilOnly = makeScryfallCard({ finishes: ['foil'], prices: { tix: '0.50' } })
    expect(formatPrintingFinishCell(foilOnly, 'nonfoil', 'tix')).toBe('0.50 tix')
  })
})

describe('formatPriceColumn', () => {
  test('pads labels so the prices align in one column, carrying each row value', () => {
    expect(
      formatPriceColumn([
        { label: 'Alpha', prices: ['$1.00'], value: 'a' },
        { label: 'A much longer label', prices: ['$22.50'], value: 'b' },
      ]),
    ).toEqual([
      { title: 'Alpha                $1.00', value: 'a' },
      { title: 'A much longer label  $22.50', value: 'b' },
    ])
  })

  test('aligns each further column to its own width, blanking absent cells', () => {
    expect(
      formatPriceColumn([
        { label: 'Alpha', prices: ['$1.00', '$22.50 foil'], value: 'a' },
        { label: 'Beta', prices: [null, '$3.00 foil'], value: 'b' },
      ]).map((c) => c.title),
    ).toEqual(['Alpha  $1.00  $22.50 foil', 'Beta          $3.00 foil'])
  })

  test('trims a trailing blank cell rather than padding it', () => {
    expect(
      formatPriceColumn([
        { label: 'Alpha', prices: ['$1.00', '$22.50 foil'], value: 'a' },
        { label: 'Beta', prices: ['$3.00', null], value: 'b' },
      ]).map((c) => c.title),
    ).toEqual(['Alpha  $1.00  $22.50 foil', 'Beta   $3.00'])
  })

  test('leaves a priceless row unpadded and out of the width calculation', () => {
    expect(
      formatPriceColumn([
        { label: 'No preference (any finish)', prices: [null], value: 'none' },
        { label: 'Foil', prices: ['$3.00'], value: 'foil' },
      ]).map((c) => c.title),
    ).toEqual(['No preference (any finish)', 'Foil  $3.00'])
  })

  test('caps the column so one long label does not shift the rest', () => {
    const long = 'x'.repeat(MAX_PRICE_COLUMN_LABEL + 20)
    const [first, second] = formatPriceColumn([
      { label: long, prices: ['$1.00'], value: 1 },
      { label: 'Short', prices: ['$2.00'], value: 2 },
    ])
    expect(first!.title).toBe(`${long}  $1.00`)
    expect(second!.title).toBe(`${'Short'.padEnd(MAX_PRICE_COLUMN_LABEL)}  $2.00`)
  })

  test('caps at a width that still fits a price cell on an 80-column terminal', () => {
    const widestRow = `${'x'.repeat(MAX_PRICE_COLUMN_LABEL)}  $1,234.56 etched`
    expect(widestRow.length).toBeLessThanOrEqual(80)
  })
})

describe('isFinishPricelessInCurrency', () => {
  test('only etched in EUR has no price field to read', () => {
    expect(isFinishPricelessInCurrency('etched', 'eur')).toBe(true)
    expect(isFinishPricelessInCurrency('etched', 'usd')).toBe(false)
    expect(isFinishPricelessInCurrency('etched', 'tix')).toBe(false)
    expect(isFinishPricelessInCurrency('nonfoil', 'eur')).toBe(false)
    expect(isFinishPricelessInCurrency('foil', 'eur')).toBe(false)
  })
})
