import { describe, expect, test } from 'bun:test'
import {
  MAX_BUYLIST_PRINTINGS,
  parseBuylistQuoteBody,
  type BuylistQuoteBody,
} from '../../../src/api/buylist'

const printing = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  set: 'DSK',
  collectorNumber: '136',
  finish: 'nonfoil',
  ...overrides,
})

describe('parseBuylistQuoteBody', () => {
  test('defaults the buyer and lowercases set codes', () => {
    const parsed = parseBuylistQuoteBody({ printings: [printing()] })

    expect(parsed).toEqual({
      buyer: 'cardkingdom',
      printings: [{ set: 'dsk', collectorNumber: '136', finish: 'nonfoil' }],
    })
  })

  test('keeps a scryfall id when given and drops an empty one', () => {
    expect(parseBuylistQuoteBody({ printings: [printing({ scryfallId: 'abc' })] })).toMatchObject({
      printings: [{ scryfallId: 'abc' }],
    })
    const blank = parseBuylistQuoteBody({ printings: [printing({ scryfallId: '' })] })
    // Must be accepted, not refused — and the empty id dropped rather than sent on.
    expect(typeof blank).not.toBe('string')
    expect((blank as BuylistQuoteBody).printings[0]).not.toHaveProperty('scryfallId')
  })

  test.each([
    ['a non-array printings', { printings: 'nope' }, '"printings" must be an array'],
    ['an unknown buyer', { buyer: 'tcgplayer', printings: [] }, '"buyer" must be one of'],
    ['a missing set', { printings: [printing({ set: undefined })] }, 'printings[0].set'],
    [
      'a blank collector number',
      { printings: [printing({ collectorNumber: '' })] },
      'printings[0].collectorNumber',
    ],
    ['a bad finish', { printings: [printing({ finish: 'shiny' })] }, 'printings[0].finish'],
    [
      'a non-string scryfall id',
      { printings: [printing({ scryfallId: 7 })] },
      'printings[0].scryfallId',
    ],
    ['a non-object printing', { printings: ['dsk:136'] }, 'printings[0]'],
  ])('refuses %s', (_label, body, expected) => {
    const parsed = parseBuylistQuoteBody(body)
    expect(typeof parsed).toBe('string')
    expect(parsed as string).toContain(expected)
  })

  test('refuses more than the per-request cap so one call cannot scan the feed', () => {
    const parsed = parseBuylistQuoteBody({
      printings: Array.from({ length: MAX_BUYLIST_PRINTINGS + 1 }, () => printing()),
    })

    expect(parsed).toBe(`"printings" must contain at most ${MAX_BUYLIST_PRINTINGS} entries`)
  })
})
