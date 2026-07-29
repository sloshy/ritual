import { describe, expect, test } from 'bun:test'
import { parsePositiveInteger } from '../../src/parse-number'

/**
 * The one positive-integer rule every surface shares: `--card-id`, `--limit`,
 * `scry --pages`, and `GET /api/card-search?page=`. Each caller words its own
 * error, so this pins acceptance only — and a caller that trims first (the
 * query-string parser does, since a URL carries whatever whitespace was
 * encoded) is accepting the trimmed value against this same rule.
 */

describe('parsePositiveInteger', () => {
  test.each([
    ['1', 1],
    ['7', 7],
    ['1000000', 1_000_000],
  ])('accepts %s', (raw, expected) => {
    expect(parsePositiveInteger(raw)).toBe(expected)
  })

  test.each([
    ['zero', '0'],
    ['a leading zero', '01'],
    ['a negative', '-3'],
    ['an explicit plus', '+3'],
    ['a decimal', '1.5'],
    ['surrounding whitespace', ' 3 '],
    ['an empty string', ''],
    ['non-digits', 'abc'],
    ['a trailing suffix', '3px'],
    ['hex', '0x10'],
    ['exponent notation', '1e3'],
    ['Infinity', 'Infinity'],
  ])('rejects %s', (_label, raw) => {
    expect(parsePositiveInteger(raw)).toBeUndefined()
  })
})
