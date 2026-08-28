import { describe, expect, test } from 'bun:test'
import {
  MAX_BUYLIST_PRINTINGS,
  parseBuylistQuoteBody,
  requireBuylistFeed,
  type BuylistQuoteBody,
} from '../../../src/api/buylist'
import { bindWorkspace } from '../../helpers/workspace'

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

  test('forwards a valid language so the matcher can refuse non-English entries', () => {
    expect(parseBuylistQuoteBody({ printings: [printing({ language: 'ja' })] })).toMatchObject({
      printings: [{ language: 'ja' }],
    })
    // A language-less printing stays language-less (absent means English).
    const bare = parseBuylistQuoteBody({ printings: [printing()] })
    expect((bare as BuylistQuoteBody).printings[0]).not.toHaveProperty('language')
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
    [
      'an unknown language',
      { printings: [printing({ language: 'klingon' })] },
      'printings[0].language',
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

describe('requireBuylistFeed', () => {
  test('refuses with a 503 when no feed has been downloaded', async () => {
    // Pointed at an empty base dir rather than a stub: the memo is keyed on the
    // cache file's path, so a workspace with no `cache/cardkingdom.json` is the
    // real "nobody has run a refresh yet" state every sell route can hit.
    const ws = await bindWorkspace()
    try {
      const result = await requireBuylistFeed()
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(503)
    } finally {
      await ws.dispose()
    }
  })
})
