import { describe, expect, test } from 'bun:test'
import {
  displayWidth,
  padEndDisplay,
  padStartDisplay,
  truncateToWidth,
  WIDE_RANGES,
  ZERO_WIDTH_RANGES,
} from '../../../src/i18n/width'

type WidthCase = {
  name: string
  input: string
  expected: number
}

describe('displayWidth', () => {
  const cases: WidthCase[] = [
    { name: 'ASCII counts one column per character', input: 'Sol Ring', expected: 8 },
    { name: 'the empty string is zero', input: '', expected: 0 },
    // The bug this module exists for: `[ja]` card names already reach the
    // column-aligned CLI tables, where `String.length` under-counts them by half.
    { name: 'CJK ideographs are double-width', input: '日本語', expected: 6 },
    { name: 'kana are double-width', input: 'カード', expected: 6 },
    { name: 'Hangul syllables are double-width', input: '한국어', expected: 6 },
    { name: 'fullwidth forms are double-width', input: 'ＡＢ', expected: 4 },
    { name: 'mixed scripts add up', input: 'Sol 指輪', expected: 8 },
    { name: 'precomposed accents are one column', input: 'café', expected: 4 },
    // Grapheme clustering, not code-unit counting: the combining acute joins
    // its base letter instead of claiming a column of its own.
    { name: 'combining marks join their base', input: 'café', expected: 4 },
    { name: 'several combining marks still join', input: 'ę́', expected: 1 },
    { name: 'a BMP emoji is double-width', input: '⭐', expected: 2 },
    { name: 'an astral emoji is double-width', input: '🎴', expected: 2 },
    { name: 'a skin-tone sequence stays one glyph', input: '👍🏽', expected: 2 },
    { name: 'a ZWJ family sequence stays one glyph', input: '👨‍👩‍👧', expected: 2 },
    { name: 'a zero-width space adds nothing', input: 'a​b', expected: 2 },
  ]

  for (const { name, input, expected } of cases) {
    test(name, () => {
      expect(displayWidth(input)).toBe(expected)
    })
  }

  test('String.length disagrees exactly where it matters', () => {
    // Pins the motivation: if these ever agreed, the module would be redundant.
    expect('日本語'.length).toBe(3)
    expect(displayWidth('日本語')).toBe(6)
    expect('👨‍👩‍👧'.length).toBe(8)
    expect(displayWidth('👨‍👩‍👧')).toBe(2)
  })
})

describe('padEndDisplay', () => {
  test('pads ASCII like padEnd does', () => {
    expect(padEndDisplay('abc', 6)).toBe('abc   ')
  })

  test('pads CJK by columns, not code units', () => {
    expect(padEndDisplay('日本', 6)).toBe('日本  ')
  })

  test('columns align across scripts', () => {
    const rows = ['Sol Ring', '日本語', 'café'].map((name) => padEndDisplay(name, 12) + '|')
    for (const row of rows) {
      expect(displayWidth(row)).toBe(13)
    }
  })

  test('never truncates when the text already overflows', () => {
    expect(padEndDisplay('日本語', 2)).toBe('日本語')
  })

  test('a wide fill only pads while it fits', () => {
    expect(padEndDisplay('a', 6, '日')).toBe('a日日')
  })

  test('an empty fill cannot loop forever', () => {
    expect(padEndDisplay('a', 6, '')).toBe('a')
  })
})

describe('padStartDisplay', () => {
  test('pads on the left by columns', () => {
    expect(padStartDisplay('日本', 6)).toBe('  日本')
  })
})

describe('truncateToWidth', () => {
  test('leaves text that already fits', () => {
    expect(truncateToWidth('Sol Ring', 20)).toBe('Sol Ring')
  })

  test('cuts to the budget including the ellipsis', () => {
    expect(displayWidth(truncateToWidth('Sol Ring of Doom', 10))).toBeLessThanOrEqual(10)
  })

  test('cuts on grapheme boundaries so a wide glyph is kept or dropped whole', () => {
    const truncated = truncateToWidth('日本語のカード', 7)
    expect(displayWidth(truncated)).toBeLessThanOrEqual(7)
    expect(truncated.endsWith('…')).toBe(true)
  })

  test('an impossible budget yields the empty string', () => {
    expect(truncateToWidth('日本語', 1)).toBe('')
  })
})

/**
 * `inRanges` short-circuits with `if (cp < start) return false`, which is only
 * correct while both tables are sorted by their start code point. Appending one
 * range out of order — easy, since the emoji singletons are interleaved by hand —
 * would silently make every code point above it measure as width 1, quietly
 * un-fixing the CJK alignment bug this module exists for.
 */
describe('the range tables', () => {
  test('are sorted by start code point, with no inverted range', () => {
    for (const ranges of [WIDE_RANGES, ZERO_WIDTH_RANGES]) {
      const starts = ranges.map(([start]) => start)
      expect(starts).toEqual([...starts].sort((a, b) => a - b))
      for (const [start, end] of ranges) expect(start).toBeLessThanOrEqual(end)
    }
  })
})
