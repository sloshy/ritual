import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_WARM_LIMIT,
  SCRYFALL_PAGE_SIZE,
  parseCardSearchParams,
} from '../../../src/api/card-search'
import { keyedRefusal, refusal } from '../../helpers/api-message'
import { withSyntheticLocale } from '../../helpers/sync-text'
import { t } from '../../../src/i18n/t'

/**
 * `GET /api/card-search`'s query-string parser. It validates and returns a
 * message rather than throwing, so the handler can turn any rejection into a
 * 400 without knowing which field was wrong.
 */

/** The parsed params, or a refusal's English `message`. */
function parse(query: string): unknown {
  return refusal(parseCardSearchParams(new URLSearchParams(query)))
}

describe('parseCardSearchParams', () => {
  test('a missing q is refused', () => {
    const refused = parseCardSearchParams(new URLSearchParams(''))
    expect(keyedRefusal(refused)).toBe('"q" is required.')
    expect(refused).toMatchObject({
      messageKey: 'admin.api.field.required',
      messageParams: { field: 'q' },
    })
  })

  test('a blank q is refused rather than searching for nothing', () => {
    expect(parse('q=%20%20')).toBe('"q" is required.')
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
    const refused = parseCardSearchParams(new URLSearchParams(`q=bolt&${queryPart}`))
    expect(keyedRefusal(refused)).toBe(`Invalid "page" '${raw}'. Use a positive integer.`)
    expect(refused).toMatchObject({
      messageKey: 'admin.api.field.notPositiveInteger',
      messageParams: { field: 'page', value: raw },
    })
  })

  test('the refused value is the trimmed one the rule judged', () => {
    const refused = parseCardSearchParams(new URLSearchParams('q=bolt&page=%20abc%20'))
    expect(refused).toMatchObject({ messageParams: { field: 'page', value: 'abc' } })
  })

  test('warm accepts only true and false, in any case, never a coerced value', () => {
    expect(parse('q=bolt&warm=true')).toEqual({
      query: 'bolt',
      page: 1,
      warm: true,
      limit: DEFAULT_WARM_LIMIT,
    })
    expect(parse('q=bolt&warm=false')).toEqual({ query: 'bolt', page: 1, warm: false })
    // The shared fixed-choice rule: case-insensitive, read as its canonical value.
    expect(parse('q=bolt&warm=TRUE')).toEqual({
      query: 'bolt',
      page: 1,
      warm: true,
      limit: DEFAULT_WARM_LIMIT,
    })
    expect(parse('q=bolt&warm=1')).toBe("Invalid warm '1'. Use one of: true, false.")
    expect(parse('q=bolt&warm=yes')).toBe("Invalid warm 'yes'. Use one of: true, false.")
  })

  test('a bad warm is refused in English with its key, whatever the server’s language', () => {
    const refused = withSyntheticLocale('xx', { 'errors.enum.invalid': 'FALSCH {value}' }, () => {
      // Vacuity guard: the server's own language really is the synthetic one.
      expect(t('errors.enum.invalid', { field: 'warm', value: '1', choices: '' })).toBe('FALSCH 1')
      return parseCardSearchParams(new URLSearchParams('q=bolt&warm=1'))
    })
    expect(keyedRefusal(refused)).toBe("Invalid warm '1'. Use one of: true, false.")
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
    const tooLarge = parseCardSearchParams(
      new URLSearchParams(`q=bolt&limit=${SCRYFALL_PAGE_SIZE + 1}`),
    )
    expect(keyedRefusal(tooLarge)).toBe(
      `"limit" must be at most ${SCRYFALL_PAGE_SIZE} (one Scryfall page), got '${SCRYFALL_PAGE_SIZE + 1}'.`,
    )
    expect(tooLarge).toMatchObject({
      messageKey: 'admin.api.cardSearch.limitTooLarge',
      messageParams: { max: SCRYFALL_PAGE_SIZE, value: String(SCRYFALL_PAGE_SIZE + 1) },
    })
    const zero = parseCardSearchParams(new URLSearchParams('q=bolt&limit=0'))
    expect(keyedRefusal(zero)).toBe('Invalid "limit" \'0\'. Use a positive integer.')
    expect(zero).toMatchObject({ messageParams: { field: 'limit', value: '0' } })
  })
})
