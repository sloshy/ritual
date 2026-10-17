import { describe, expect, test } from 'bun:test'
import { MAX_CARD_IDS, parseCardIdsParam } from '../../../src/api/cards'
import { keyedRefusal } from '../../helpers/api-message'

/** The `ids` query param of `GET /api/cards`: what it accepts, and how it refuses. */
describe('parseCardIdsParam', () => {
  test('splits, trims, and de-duplicates the ids', () => {
    expect(parseCardIdsParam(' a , b,a ,,b')).toEqual(['a', 'b'])
  })

  test.each<[string, string | null, string, Record<string, unknown> | undefined, string]>([
    ['a missing param', null, 'admin.api.field.required', { field: 'ids' }, '"ids" is required.'],
    [
      'an empty param',
      '',
      'admin.api.cards.idsEmpty',
      undefined,
      '"ids" must contain at least one Scryfall ID.',
    ],
    [
      'nothing but separators',
      ',,',
      'admin.api.cards.idsEmpty',
      undefined,
      '"ids" must contain at least one Scryfall ID.',
    ],
    [
      'more ids than the cap',
      Array.from({ length: MAX_CARD_IDS + 1 }, (_, i) => `id-${i}`).join(','),
      'admin.api.field.tooMany',
      { field: 'ids', count: MAX_CARD_IDS },
      `"ids" must contain at most ${MAX_CARD_IDS} entries.`,
    ],
  ])('rejects %s in English with its key', (_label, raw, key, params, message) => {
    const refused = parseCardIdsParam(raw)
    expect(keyedRefusal(refused)).toBe(message)
    expect(refused).toMatchObject({ messageKey: key })
    expect((refused as { messageParams?: unknown }).messageParams).toEqual(params)
  })

  test('accepts exactly the cap', () => {
    const ids = Array.from({ length: MAX_CARD_IDS }, (_, i) => `id-${i}`)
    expect(parseCardIdsParam(ids.join(','))).toHaveLength(MAX_CARD_IDS)
  })
})
