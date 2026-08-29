import { describe, expect, test } from 'bun:test'
import { parseCardLine } from '../../src/card/card-line-grammar'
import {
  aggregateDialectCards,
  dialectBoard,
  isDecklistSection,
  formatDialectCardLine,
  renderDialectText,
  type DialectBoard,
  type DialectCard,
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
  // A dialect decklist has four buckets, and every section that belongs in one
  // — free text included — must land there rather than being dropped.
  const cases: readonly [string, DialectBoard][] = [
    ['Commander', 'Commander'],
    ['Companion', 'Companion'],
    ['Sideboard', 'Sideboard'],
    ['Creatures', 'Deck'],
    ['Main', 'Deck'],
  ]

  test.each(cases)('maps %p onto the %p board', (section, board) => {
    expect(dialectBoard(section)).toBe(board)
  })

  // A maybeboard or token box is deck-building scratch space, not part of a
  // decklist: no dialect models one, and folding it under `Sideboard` would hand
  // the reader a sideboard they never built.
  test.each(['Maybeboard', 'Tokens'])('gives %p no board at all', (section) => {
    expect(dialectBoard(section)).toBeUndefined()
    expect(isDecklistSection(section)).toBe(false)
  })

  // The sideboard is part of the decklist and survived the extras change — the
  // half of `isDecklistSection` the drop cases above cannot pin.
  test.each(['Sideboard', 'Main', 'Commander'])('counts %p as decklist', (section) => {
    expect(isDecklistSection(section)).toBe(true)
  })
})

describe('formatDialectCardLine', () => {
  // Moxfield's bulk-edit grammar is `<amount> <name> <set> <is foil> …
  // <collector number>`, so the marker sits between the set and the number.
  test('moxfield writes the finish marker between the set and the collector number', () => {
    expect(
      formatDialectCardLine(
        { quantity: 1, name: 'Mana Crypt', set: '2xm', collectorNumber: '270', finish: 'foil' },
        'moxfield',
      ),
    ).toBe('1 Mana Crypt (2XM) *F* 270')
  })

  test('moxfield drops a finish it has nowhere to put', () => {
    // A set with no collector number writes no printing, and Moxfield's grammar
    // puts the marker *inside* the printing — so there is no slot left for it.
    expect(
      formatDialectCardLine(
        { quantity: 1, name: 'Sol Ring', set: '2xm', finish: 'foil' },
        'moxfield',
      ),
    ).toBe('1 Sol Ring')
  })

  test('writes the printing only as a pair', () => {
    // A bare `(2XM)` would be read back as part of the card's name, so a set
    // with no collector number writes no printing at all.
    expect(formatDialectCardLine({ quantity: 1, name: 'Sol Ring', set: '2xm' }, 'arena')).toBe(
      '1 Sol Ring',
    )
    // The marker has no slot of its own in Moxfield's grammar, so a finish on a
    // printing-less card goes unwritten rather than being misplaced.
    expect(
      formatDialectCardLine(
        { quantity: 1, name: 'Sol Ring', collectorNumber: '270', finish: 'foil' },
        'moxfield',
      ),
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

  test('drops cards from sections a decklist has no board for', () => {
    const text = renderDialectText(
      aggregateDialectCards([
        card({ section: 'Main' }),
        card({ section: 'Maybeboard', name: 'Worldspine Wurm' }),
        card({ section: 'Tokens', name: 'Treasure' }),
      ]),
      'arena',
    )
    expect(text).toBe('Deck\n1 Lightning Bolt (2XM) 157')
  })

  test('keeps variants the line never prints on separate lines', () => {
    const text = renderDialectText(
      aggregateDialectCards([card({ condition: 'NM' }), card({ condition: 'LP' })]),
      'arena',
    )
    expect(text).toBe('Deck\n1 Lightning Bolt (2XM) 157\n1 Lightning Bolt (2XM) 157')
  })
})

// The claim `TextDialect`'s doc makes — that Ritual reads its own moxfield
// export back — asserted rather than restated. Both sides are generated here, so
// a change to the written form that the writer's own test was updated to match
// still fails if the tokenizer can no longer read it.
describe('moxfield round trip', () => {
  const cards: readonly DialectCard[] = [
    { quantity: 1, name: 'Mana Crypt', set: '2xm', collectorNumber: '270', finish: 'foil' },
    { quantity: 1, name: 'Sol Ring', set: 'cmm', collectorNumber: '410', finish: 'etched' },
    { quantity: 4, name: 'Forest', set: 'unf', collectorNumber: '243' },
  ]

  for (const card of cards) {
    test(`${card.name} re-parses from the line moxfield writes`, () => {
      const parsed = parseCardLine('deck', formatDialectCardLine(card, 'moxfield'))
      expect(parsed).toMatchObject({
        ok: true,
        tokens: {
          quantity: card.quantity,
          name: card.name,
          printing: { set: card.set, collectorNumber: card.collectorNumber },
        },
      })
      // `finish` is absent rather than `nonfoil` on an unmarked line, so it is
      // asserted separately instead of through the object above.
      expect(parsed.ok ? parsed.tokens.finish : undefined).toBe(card.finish)
    })
  }
})
