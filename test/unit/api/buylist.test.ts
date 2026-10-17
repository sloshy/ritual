import { describe, expect, test } from 'bun:test'
import { CARD_LANGUAGES } from '../../../src/card/card-language'
import { keyedSyncRefusal, syncRefusal } from '../../helpers/api-message'
import {
  MAX_BUYLIST_PRINTINGS,
  parseBuylistQuoteBody,
  requireBuylistFeed,
  type BuylistQuoteBody,
} from '../../../src/api/buylist'
import { bindWorkspace } from '../../helpers/workspace'
import type { MessageKey } from '../../../src/i18n/messages/en'
import type { SyncMessageParams } from '../../../src/sync/message'

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
    // Accepted, not refused — and the empty id dropped rather than sent on.
    expect(parseBuylistQuoteBody({ printings: [printing({ scryfallId: '' })] })).toEqual({
      buyer: 'cardkingdom',
      printings: [{ set: 'dsk', collectorNumber: '136', finish: 'nonfoil' }],
    })
  })

  test('forwards a valid language so the matcher can refuse non-English entries', () => {
    expect(parseBuylistQuoteBody({ printings: [printing({ language: 'ja' })] })).toMatchObject({
      printings: [{ language: 'ja' }],
    })
    // A language-less printing stays language-less (absent means English).
    const bare = parseBuylistQuoteBody({ printings: [printing()] })
    expect((bare as BuylistQuoteBody).printings[0]).not.toHaveProperty('language')
  })

  type RefusalCase = [
    label: string,
    body: Record<string, unknown>,
    key: MessageKey,
    params: SyncMessageParams,
    english: string,
  ]
  const enumChoices = 'nonfoil, foil, etched'
  test.each<RefusalCase>([
    [
      'a non-array printings',
      { printings: 'nope' },
      'admin.api.field.notArray',
      { field: 'printings' },
      '"printings" must be an array.',
    ],
    [
      'an unknown buyer',
      { buyer: 'tcgplayer', printings: [] },
      'errors.enum.invalid',
      { field: 'buyer', value: 'tcgplayer', choices: 'cardkingdom' },
      "Invalid buyer 'tcgplayer'. Use one of: cardkingdom.",
    ],
    [
      'a missing set',
      { printings: [printing({ set: undefined })] },
      'admin.api.field.blank',
      { field: 'printings[0].set' },
      '"printings[0].set" must be a non-empty string.',
    ],
    [
      'a whitespace-only set',
      { printings: [printing({ set: '   ' })] },
      'admin.api.field.blank',
      { field: 'printings[0].set' },
      '"printings[0].set" must be a non-empty string.',
    ],
    [
      'a blank collector number',
      { printings: [printing({ collectorNumber: ' ' })] },
      'admin.api.field.blank',
      { field: 'printings[0].collectorNumber' },
      '"printings[0].collectorNumber" must be a non-empty string.',
    ],
    [
      'a bad finish',
      { printings: [printing({ finish: 'shiny' })] },
      'errors.enum.invalid',
      { field: 'printings[0].finish', value: 'shiny', choices: enumChoices },
      `Invalid printings[0].finish 'shiny'. Use one of: ${enumChoices}.`,
    ],
    [
      'a missing finish',
      { printings: [printing({ finish: undefined })] },
      'errors.enum.type',
      { field: 'printings[0].finish', choices: enumChoices },
      `printings[0].finish must be one of: ${enumChoices}.`,
    ],
    [
      'a non-string scryfall id',
      { printings: [printing({ scryfallId: 7 })] },
      'admin.api.field.notString',
      { field: 'printings[0].scryfallId' },
      '"printings[0].scryfallId" must be a string.',
    ],
    [
      'a non-object printing',
      { printings: ['dsk:136'] },
      'admin.api.field.notObject',
      { field: 'printings[0]' },
      '"printings[0]" must be an object.',
    ],
    [
      'more printings than the per-request cap',
      { printings: Array.from({ length: MAX_BUYLIST_PRINTINGS + 1 }, () => printing()) },
      'admin.api.field.tooMany',
      { field: 'printings', count: MAX_BUYLIST_PRINTINGS },
      `"printings" must contain at most ${MAX_BUYLIST_PRINTINGS} entries.`,
    ],
  ])('refuses %s in English plus its key', (_label, body, key, params, english) => {
    const parsed = syncRefusal(parseBuylistQuoteBody(body))
    expect(keyedSyncRefusal(parsed)).toBe(english)
    expect(parsed.messageKey).toBe(key)
    expect(parsed.messageParams).toEqual(params)
  })

  test('names the offending entry by its indexed path', () => {
    const parsed = syncRefusal(
      parseBuylistQuoteBody({ printings: [printing(), printing({ set: '' })] }),
    )
    expect(parsed.messageParams).toEqual({ field: 'printings[1].set' })
  })

  test('trims the set and collector number it accepts', () => {
    const parsed = parseBuylistQuoteBody({
      printings: [printing({ set: ' DSK ', collectorNumber: ' 136 ' })],
    })
    expect(parsed).toMatchObject({ printings: [{ set: 'dsk', collectorNumber: '136' }] })
  })

  // The shared enum rule, as `--finish` reads it on the CLI.
  test('reads a buyer case-insensitively, as its canonical spelling', () => {
    expect(parseBuylistQuoteBody({ buyer: 'CardKingdom', printings: [] })).toEqual({
      buyer: 'cardkingdom',
      printings: [],
    })
  })

  test('reads a finish case-insensitively, as its canonical spelling', () => {
    const parsed = parseBuylistQuoteBody({ printings: [printing({ finish: 'FOIL' })] })
    expect(parsed).toMatchObject({ printings: [{ finish: 'foil' }] })
  })

  test('folds a language code to lowercase, as it does a finish', () => {
    const parsed = parseBuylistQuoteBody({ printings: [printing({ language: 'JA' })] })
    expect(parsed).toMatchObject({ printings: [{ language: 'ja' }] })
  })

  test.each([
    ['an unknown language', 'klingon', '"klingon"'],
    ['a non-string language', 7, '7'],
  ])('refuses %s in English plus its key, the code list nested', (_label, language, shown) => {
    const parsed = syncRefusal(parseBuylistQuoteBody({ printings: [printing({ language })] }))
    expect(keyedSyncRefusal(parsed)).toBe(
      `Invalid language ${shown} for "printings[0].language". Valid languages: ${CARD_LANGUAGES.join(', ')}`,
    )
    expect(parsed.messageKey).toBe('domain.card.language.invalidField')
    expect(parsed.messageParams?.languages).toEqual({ list: CARD_LANGUAGES, join: 'unit' })
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
