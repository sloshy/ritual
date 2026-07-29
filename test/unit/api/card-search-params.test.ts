import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_WARM_LIMIT,
  SCRYFALL_PAGE_SIZE,
  parseCardSearchParams,
} from '../../../src/api/card-search'

/**
 * `GET /api/card-search`'s query-string parser. It validates and returns a
 * message rather than throwing, so the handler can turn any rejection into a
 * 400 without knowing which field was wrong.
 */

function parse(query: string): ReturnType<typeof parseCardSearchParams> {
  return parseCardSearchParams(new URLSearchParams(query))
}

describe('parseCardSearchParams', () => {
  test('a missing q is refused', () => {
    expect(parse('')).toBe('q is required.')
  })

  test('a blank q is refused rather than searching for nothing', () => {
    expect(parse('q=%20%20')).toBe('q is required.')
  })

  test('an absent page means the first page, and warm defaults off', () => {
    expect(parse('q=t%3Acreature')).toEqual({ query: 't:creature', page: 1, warm: false })
  })

  test('the query is trimmed, since that is what is sent to Scryfall', () => {
    expect(parse('q=%20%20t%3Acreature%20')).toEqual({
      query: 't:creature',
      page: 1,
      warm: false,
    })
  })

  test('a page is carried through as a number', () => {
    expect(parse('q=bolt&page=3')).toEqual({ query: 'bolt', page: 3, warm: false })
  })

  test.each([
    ['page=0', '0'],
    ['page=-1', '-1'],
    ['page=abc', 'abc'],
    ['page=1.5', '1.5'],
  ])('%s is refused with the offending value', (queryPart, raw) => {
    expect(parse(`q=bolt&${queryPart}`)).toBe(`page must be a positive integer, got '${raw}'.`)
  })

  test('warm accepts only true and false, never a coerced value', () => {
    expect(parse('q=bolt&warm=true')).toEqual({
      query: 'bolt',
      page: 1,
      warm: true,
      limit: DEFAULT_WARM_LIMIT,
    })
    expect(parse('q=bolt&warm=false')).toEqual({ query: 'bolt', page: 1, warm: false })
    expect(parse('q=bolt&warm=1')).toBe("Invalid warm '1'. Use one of: true, false.")
    expect(parse('q=bolt&warm=yes')).toBe("Invalid warm 'yes'. Use one of: true, false.")
  })

  test('an explicit limit overrides the warm default', () => {
    expect(parse('q=bolt&warm=true&limit=5')).toEqual({
      query: 'bolt',
      page: 1,
      warm: true,
      limit: 5,
    })
  })

  test('a limit without warm caps a plain read', () => {
    expect(parse('q=bolt&limit=5')).toEqual({ query: 'bolt', page: 1, warm: false, limit: 5 })
  })

  test('a limit past one Scryfall page is refused', () => {
    expect(parse(`q=bolt&limit=${SCRYFALL_PAGE_SIZE + 1}`)).toBe(
      `limit must be at most ${SCRYFALL_PAGE_SIZE} (one Scryfall page), got '${SCRYFALL_PAGE_SIZE + 1}'.`,
    )
    expect(parse('q=bolt&limit=0')).toBe("Invalid limit '0'. Use a positive integer.")
  })
})
