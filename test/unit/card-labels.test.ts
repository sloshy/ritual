import { describe, expect, test } from 'bun:test'
import {
  CARD_LABEL_DISPLAY_NAMES,
  CARD_LABELS,
  effectiveLabels,
  formatCardLabels,
  isCardLabel,
  normalizeCardLabels,
  parseCardLabelsToken,
  parseCardLabelsValue,
} from '../../src/card-labels'

describe('isCardLabel', () => {
  test('accepts exactly the pinned vocabulary and rejects everything else', () => {
    // Pin the vocabulary itself: file tokens and changelog lines persist these
    // strings, so widening or renaming them must be a deliberate act.
    expect([...CARD_LABELS]).toEqual(['sale', 'trade', 'keep'])
    expect(isCardLabel('sale')).toBe(true)
    expect(isCardLabel('SALE')).toBe(false)
    expect(isCardLabel('sell')).toBe(false)
    expect(isCardLabel('')).toBe(false)
  })
})

describe('normalizeCardLabels', () => {
  test('dedupes and orders canonically (sale before trade)', () => {
    expect(normalizeCardLabels(['trade', 'sale', 'trade'])).toEqual(['sale', 'trade'])
  })

  test('leaves a single label untouched', () => {
    expect(normalizeCardLabels(['keep'])).toEqual(['keep'])
  })
})

describe('parseCardLabelsToken', () => {
  test('parses a single label', () => {
    expect(parseCardLabelsToken('sale')).toEqual({ ok: true, labels: ['sale'] })
  })

  test('parses a pair and normalizes the order', () => {
    expect(parseCardLabelsToken('trade,sale')).toEqual({ ok: true, labels: ['sale', 'trade'] })
  })

  test('dedupes repeated labels', () => {
    expect(parseCardLabelsToken('sale,sale')).toEqual({ ok: true, labels: ['sale'] })
  })

  test('is case-insensitive like every enum surface', () => {
    expect(parseCardLabelsToken('SALE,Trade')).toEqual({ ok: true, labels: ['sale', 'trade'] })
  })

  test('refuses keep combined with sale or trade', () => {
    const result = parseCardLabelsToken('sale,keep')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("'keep' cannot be combined")
  })

  test('refuses unknown members', () => {
    const result = parseCardLabelsToken('sale,sell')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("'sell'")
  })

  test('refuses an empty body and dangling commas', () => {
    expect(parseCardLabelsToken('').ok).toBe(false)
    expect(parseCardLabelsToken('sale,').ok).toBe(false)
  })
})

describe('parseCardLabelsValue', () => {
  test('parses an array case-insensitively and normalizes', () => {
    expect(parseCardLabelsValue(['Trade', 'SALE'], 'labels')).toEqual({
      ok: true,
      labels: ['sale', 'trade'],
    })
  })

  test('an empty array is ok (callers decide what empty means)', () => {
    expect(parseCardLabelsValue([], 'labels')).toEqual({ ok: true, labels: [] })
  })

  test('refuses non-arrays', () => {
    expect(parseCardLabelsValue('sale', 'labels').ok).toBe(false)
    expect(parseCardLabelsValue(null, 'labels').ok).toBe(false)
  })

  test('refuses non-string elements', () => {
    expect(parseCardLabelsValue([1], 'labels').ok).toBe(false)
  })

  test('refuses keep combined with the others', () => {
    expect(parseCardLabelsValue(['keep', 'trade'], 'labels').ok).toBe(false)
  })
})

describe('formatCardLabels', () => {
  test('joins in canonical order regardless of input order', () => {
    expect(formatCardLabels(['trade', 'sale'])).toBe('sale,trade')
    expect(formatCardLabels(['keep'])).toBe('keep')
  })
})

describe('effectiveLabels', () => {
  test('a present override replaces the list default entirely', () => {
    expect(effectiveLabels(['keep'], ['sale', 'trade'])).toEqual(['keep'])
  })

  test('falls back to the list default when there is no override', () => {
    expect(effectiveLabels(undefined, ['sale'])).toEqual(['sale'])
  })

  test('empty when neither is present', () => {
    expect(effectiveLabels(undefined, undefined)).toEqual([])
  })
})

describe('CARD_LABEL_DISPLAY_NAMES', () => {
  test('spells the agreed wording', () => {
    expect(CARD_LABEL_DISPLAY_NAMES.sale).toBe('For sale')
    expect(CARD_LABEL_DISPLAY_NAMES.trade).toBe('For trade')
    expect(CARD_LABEL_DISPLAY_NAMES.keep).toBe('To keep')
  })
})
