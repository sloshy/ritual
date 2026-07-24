import { describe, expect, test } from 'bun:test'
import { MAX_CARD_IDS, parseCardIdsParam } from '../../../src/api/cards'

/** The `ids` query param of `GET /api/cards`: what it accepts, and how it refuses. */
describe('parseCardIdsParam', () => {
  test('splits, trims, and de-duplicates the ids', () => {
    expect(parseCardIdsParam(' a , b,a ,,b')).toEqual(['a', 'b'])
  })

  test.each([
    ['a missing param', null, 'ids is required'],
    ['an empty param', '', 'ids must contain at least one Scryfall ID'],
    ['nothing but separators', ',,', 'ids must contain at least one Scryfall ID'],
    [
      'more ids than the cap',
      Array.from({ length: MAX_CARD_IDS + 1 }, (_, i) => `id-${i}`).join(','),
      `ids must contain at most ${MAX_CARD_IDS} entries`,
    ],
  ])('rejects %s', (_label, raw, message) => {
    expect(parseCardIdsParam(raw)).toBe(message)
  })

  test('accepts exactly the cap', () => {
    const ids = Array.from({ length: MAX_CARD_IDS }, (_, i) => `id-${i}`)
    expect(parseCardIdsParam(ids.join(','))).toHaveLength(MAX_CARD_IDS)
  })
})
