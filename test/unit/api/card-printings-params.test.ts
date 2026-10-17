import { describe, expect, test } from 'bun:test'
import { parseCardPrintingsParams } from '../../../src/api/card-printings'
import { keyedRefusal } from '../../helpers/api-message'

/**
 * `GET /api/card-printings`'s query-string parser: what it accepts, and how it
 * refuses. The route's lookup and paging are pinned in
 * test/integration/card-printings-api.test.ts.
 */

/** The parser's outcome for a query string. */
function parse(query: string): unknown {
  return parseCardPrintingsParams(new URLSearchParams(query))
}

describe('parseCardPrintingsParams', () => {
  test.each([
    ['a name alone means the full printing list', 'name=Sol%20Ring', { name: 'Sol Ring' }],
    ['the name is trimmed, since it is a cache key', 'name=%20Sol%20Ring%20', { name: 'Sol Ring' }],
    ['a limit is carried through as a number', 'name=Shock&limit=3', { name: 'Shock', limit: 3 }],
    ['a blank limit means absent', 'name=Shock&limit=%20', { name: 'Shock' }],
  ])('%s', (_label, query, expected) => {
    expect(parse(query)).toEqual(expected)
  })

  test.each([
    ['a missing name', '', 'admin.api.field.required', { field: 'name' }, '"name" is required.'],
    [
      'a blank name',
      'name=%20%20',
      'admin.api.field.required',
      { field: 'name' },
      '"name" is required.',
    ],
    [
      'a zero limit',
      'name=Shock&limit=0',
      'admin.api.field.notPositiveInteger',
      { field: 'limit', value: '0' },
      'Invalid "limit" \'0\'. Use a positive integer.',
    ],
    [
      'a non-numeric limit, judged trimmed',
      'name=Shock&limit=%20abc%20',
      'admin.api.field.notPositiveInteger',
      { field: 'limit', value: 'abc' },
      'Invalid "limit" \'abc\'. Use a positive integer.',
    ],
  ])('refuses %s in English with its key', (_label, query, key, params, english) => {
    const refused = parse(query)
    expect(keyedRefusal(refused)).toBe(english)
    expect(refused).toMatchObject({ messageKey: key, messageParams: params })
  })
})
