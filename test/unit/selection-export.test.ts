import { describe, expect, test } from 'bun:test'
import { selectionToText, selectionToCsv } from '../../src/editor/list-export'
import type { SelectedCard } from '../../src/site/useCardSelection'

function selected(overrides: Partial<SelectedCard> = {}): SelectedCard {
  return {
    key: 'k',
    name: 'Lightning Bolt',
    set: 'lea',
    collectorNumber: '161',
    quantity: 1,
    groupSize: 1,
    scryfallCard: null,
    sourceName: 'My List',
    sourceKind: 'collection',
    maxQty: 1,
    cardIds: [],
    ...overrides,
  }
}

describe('selectionToText', () => {
  test('formats a line as "N Name (SET:CN)" with the set code uppercased', () => {
    expect(selectionToText([selected()])).toBe('1 Lightning Bolt (LEA:161)')
  })

  test('omits the printing suffix for a name-only card', () => {
    expect(selectionToText([selected({ set: undefined, collectorNumber: undefined })])).toBe(
      '1 Lightning Bolt',
    )
  })

  test('sums quantities for identical printings and keeps first-seen order', () => {
    const cards = [
      selected({ key: 'a', name: 'Sol Ring', set: 'c21', collectorNumber: '263', quantity: 2 }),
      selected({ key: 'b', name: 'Sol Ring', set: 'c21', collectorNumber: '263', quantity: 1 }),
      selected({ key: 'c', name: 'Island', set: 'lea', collectorNumber: '288', quantity: 1 }),
    ]
    expect(selectionToText(cards)).toBe('3 Sol Ring (C21:263)\n1 Island (LEA:288)')
  })

  test('keeps differing finishes as separate, un-summed lines', () => {
    // Same name/printing, different finish: the text format omits finish, so the
    // two lines look identical — but they must NOT be merged into one "2x" line.
    const cards = [
      selected({ key: 'a', finish: 'foil', quantity: 1 }),
      selected({ key: 'b', finish: 'nonfoil', quantity: 1 }),
    ]
    expect(selectionToText(cards)).toBe('1 Lightning Bolt (LEA:161)\n1 Lightning Bolt (LEA:161)')
  })
})

describe('selectionToCsv', () => {
  test('emits the canonical header row', () => {
    expect(selectionToCsv([]).split('\n')[0]).toBe(
      'Name,Set,Collector Number,Finish,Condition,Quantity',
    )
  })

  test('writes set uppercased, finish/condition, and a summed quantity', () => {
    const cards = [
      selected({ key: 'a', finish: 'foil', condition: 'LP', quantity: 1 }),
      selected({ key: 'b', finish: 'foil', condition: 'LP', quantity: 1 }),
    ]
    expect(selectionToCsv(cards).split('\n')[1]).toBe('Lightning Bolt,LEA,161,foil,LP,2')
  })

  test('quotes names containing commas', () => {
    const card = selected({ name: 'Krenko, Mob Boss', set: 'ema', collectorNumber: '139' })
    expect(selectionToCsv([card]).split('\n')[1]).toBe('"Krenko, Mob Boss",EMA,139,,,1')
  })

  test('escapes embedded double quotes by doubling them (RFC 4180)', () => {
    const card = selected({ name: 'Ach! Hans, "Run!"', set: 'unh', collectorNumber: '1' })
    expect(selectionToCsv([card]).split('\n')[1]).toBe('"Ach! Hans, ""Run!""",UNH,1,,,1')
  })

  test('leaves set and collector-number columns blank for a name-only card', () => {
    const card = selected({ set: undefined, collectorNumber: undefined })
    expect(selectionToCsv([card]).split('\n')[1]).toBe('Lightning Bolt,,,,,1')
  })
})
