import { describe, expect, test } from 'bun:test'
import {
  aggregateDialectCards,
  dialectBoard,
  formatDialectCardLine,
  renderDialectText,
  type DialectBoard,
  type SectionedDialectCard,
} from '../../src/export/dialects'

function card(overrides: Partial<SectionedDialectCard> = {}): SectionedDialectCard {
  return {
    section: 'Main',
    quantity: 1,
    name: 'Lightning Bolt',
    set: '2xm',
    collectorNumber: '157',
    ...overrides,
  }
}

describe('dialectBoard', () => {
  // A dialect decklist has exactly four buckets, so every section name — free
  // text included — must land in one of them rather than being dropped.
  const cases: readonly [string, DialectBoard][] = [
    ['Commander', 'Commander'],
    ['Companion', 'Companion'],
    ['Sideboard', 'Sideboard'],
    // Neither Arena nor Moxfield models a maybeboard or a token box, so those
    // sections ride under the sideboard marker — the nearest bucket that is not
    // the deck proper.
    ['Maybeboard', 'Sideboard'],
    ['Tokens', 'Sideboard'],
    ['Creatures', 'Deck'],
    ['Main', 'Deck'],
  ]

  test.each(cases)('maps %p onto the %p board', (section, board) => {
    expect(dialectBoard(section)).toBe(board)
  })
})

describe('formatDialectCardLine', () => {
  test('writes the printing only as a pair', () => {
    // A bare `(2XM)` would be read back as part of the card's name, so a set
    // with no collector number writes no printing at all.
    expect(formatDialectCardLine({ quantity: 1, name: 'Sol Ring', set: '2xm' }, 'arena')).toBe(
      '1 Sol Ring',
    )
    expect(
      formatDialectCardLine({ quantity: 1, name: 'Sol Ring', collectorNumber: '270' }, 'moxfield'),
    ).toBe('1 Sol Ring')
  })
})

describe('aggregateDialectCards', () => {
  test('several sections sharing a board write one marker, in first-seen order', () => {
    const text = renderDialectText(
      aggregateDialectCards([
        card({ section: 'Creatures', quantity: 4, name: 'Llanowar Elves' }),
        card({ section: 'Lands', quantity: 2, name: 'Forest' }),
        card({ section: 'Sideboard', quantity: 2, name: 'Naturalize' }),
      ]),
      'arena',
    )
    expect(text).toBe(
      'Deck\n4 Llanowar Elves (2XM) 157\n2 Forest (2XM) 157\n\nSideboard\n2 Naturalize (2XM) 157',
    )
  })

  test('sums identical variants across sections that share a board', () => {
    const text = renderDialectText(
      aggregateDialectCards([card({ section: 'Lands' }), card({ section: 'Ramp' })]),
      'arena',
    )
    expect(text).toBe('Deck\n2 Lightning Bolt (2XM) 157')
  })

  test('keeps variants the line never prints on separate lines', () => {
    const text = renderDialectText(
      aggregateDialectCards([card({ condition: 'NM' }), card({ condition: 'LP' })]),
      'arena',
    )
    expect(text).toBe('Deck\n1 Lightning Bolt (2XM) 157\n1 Lightning Bolt (2XM) 157')
  })
})
