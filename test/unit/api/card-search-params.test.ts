import { describe, expect, test } from 'bun:test'
import { parseCardSearchParams } from '../../../src/api/card-search'

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

  test('an absent page means the first page', () => {
    expect(parse('q=t%3Acreature')).toEqual({ query: 't:creature', page: 1 })
  })

  test('the query is trimmed, since that is what is sent to Scryfall', () => {
    expect(parse('q=%20%20t%3Acreature%20')).toEqual({ query: 't:creature', page: 1 })
  })

  test('a page is carried through as a number', () => {
    expect(parse('q=bolt&page=3')).toEqual({ query: 'bolt', page: 3 })
  })

  test.each([
    ['page=0', '0'],
    ['page=-1', '-1'],
    ['page=abc', 'abc'],
    ['page=1.5', '1.5'],
  ])('%s is refused with the offending value', (queryPart, raw) => {
    expect(parse(`q=bolt&${queryPart}`)).toBe(`page must be a positive integer, got '${raw}'.`)
  })
})
