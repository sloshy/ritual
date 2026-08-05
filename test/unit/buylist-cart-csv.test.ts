import { describe, expect, test } from 'bun:test'
import {
  CK_CSV_MAX_CARDS,
  CK_CSV_MAX_TITLES,
  buildCkCartCsv,
  type CkCartItem,
} from '../../src/buylist'

const item = (overrides: Partial<CkCartItem> = {}): CkCartItem => ({
  name: 'Sol Ring',
  edition: 'Commander 2021',
  finish: 'nonfoil',
  quantity: 1,
  ...overrides,
})

/** The data rows of a rendered cart, trailing newline stripped. */
function rows(csv: string): string[] {
  return csv === '' ? [] : csv.trimEnd().split('\n')
}

describe('buildCkCartCsv', () => {
  test('renders one header-less row per name+edition+foil, aggregating quantities', () => {
    const cart = buildCkCartCsv([item({ quantity: 2 }), item({ quantity: 3 })])

    // CK's importer prompts for column matching, so a header row would import as a card.
    expect(cart.csv).toBe('Sol Ring,Commander 2021,false,5\n')
    expect(cart).toMatchObject({ titleCount: 1, cardCount: 5, warnings: [] })
  })

  test('keeps finishes apart and quotes cells containing commas', () => {
    const cart = buildCkCartCsv([
      item({ finish: 'foil' }),
      item({ name: 'Fire // Ice', edition: 'Apocalypse, Retro' }),
    ])

    expect(rows(cart.csv)).toEqual([
      'Sol Ring,Commander 2021,true,1',
      'Fire // Ice,"Apocalypse, Retro",false,1',
    ])
  })

  test('exports CK’s listed title for variant printings and keeps variants apart', () => {
    const cart = buildCkCartCsv([
      item({ variation: 'Retro Frame' }),
      item({ variation: 'Retro Frame' }),
      item(),
    ])

    expect(rows(cart.csv)).toEqual([
      'Sol Ring (Retro Frame),Commander 2021,false,2',
      'Sol Ring,Commander 2021,false,1',
    ])
    expect(cart.titleCount).toBe(2)
  })

  test('renders an empty file when nothing is sellable', () => {
    expect(buildCkCartCsv([item({ quantity: 0 })])).toMatchObject({
      csv: '',
      titleCount: 0,
      cardCount: 0,
    })
  })

  test('drops zero-quantity items rather than emitting empty rows', () => {
    const cart = buildCkCartCsv([item({ quantity: 0 }), item({ name: 'Arcane Signet' })])

    expect(rows(cart.csv)).toEqual(['Arcane Signet,Commander 2021,false,1'])
    expect(cart.titleCount).toBe(1)
  })

  test('exports etched as foil and names each affected card once', () => {
    const cart = buildCkCartCsv([
      item({ name: 'Sol Ring', finish: 'etched' }),
      item({ name: 'Sol Ring', finish: 'etched' }),
      item({ name: 'Arcane Signet', finish: 'etched' }),
    ])

    expect(rows(cart.csv)).toEqual([
      'Sol Ring,Commander 2021,true,2',
      'Arcane Signet,Commander 2021,true,1',
    ])
    // Named once each, not once per copy.
    expect(cart.warnings).toHaveLength(1)
    expect(cart.warnings[0]).toContain('Sol Ring, Arcane Signet')
  })

  test('reports CK’s upload caps without refusing the file', () => {
    const manyTitles = Array.from({ length: CK_CSV_MAX_TITLES + 1 }, (_, i) =>
      item({ name: `Card ${i}` }),
    )
    const overTitles = buildCkCartCsv(manyTitles)
    expect(overTitles.titleCount).toBe(CK_CSV_MAX_TITLES + 1)
    expect(overTitles.warnings).toHaveLength(1)
    expect(overTitles.warnings[0]).toContain('unique titles')

    const overCards = buildCkCartCsv([item({ quantity: CK_CSV_MAX_CARDS + 1 })])
    expect(overCards.cardCount).toBe(CK_CSV_MAX_CARDS + 1)
    expect(overCards.warnings).toHaveLength(1)
    expect(overCards.warnings[0]).toContain(`at most ${CK_CSV_MAX_CARDS} cards`)
  })
})
