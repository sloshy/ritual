import { describe, expect, test } from 'bun:test'
import {
  CSV_HEADER,
  collectionToText,
  wantedToText,
  wantedToCsv,
  deckToCsv,
  selectionToText,
  selectionToCsv,
} from '../../src/editor/list-export'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/site/data-types'
import type { SelectedCard } from '../../src/site/useCardSelection'
import type { DeckData } from '../../src/types'

function collectionEntry(overrides: Partial<CollectionCardEntry> = {}): CollectionCardEntry {
  return {
    name: 'Lightning Bolt',
    set: 'lea',
    collectorNumber: '161',
    finish: 'nonfoil',
    condition: 'NM',
    price: 0,
    fileOrder: 0,
    section: 'Main',
    ...overrides,
  }
}

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

function wantedEntry(overrides: Partial<WantedListCardEntry> = {}): WantedListCardEntry {
  return {
    name: 'Mana Crypt',
    set: '2xm',
    collectorNumber: '1',
    price: 0,
    fileOrder: 0,
    section: 'Main',
    state: 'fully-specified',
    ...overrides,
  }
}

describe('collectionToText', () => {
  test('formats a line as "N Name (SET:CN)" with the set code uppercased', () => {
    expect(collectionToText([collectionEntry()])).toBe('1 Lightning Bolt (LEA:161)')
  })

  test('groups identical printings and sums their counts', () => {
    const entries = [
      collectionEntry({ name: 'Sol Ring', set: 'c21', collectorNumber: '263' }),
      collectionEntry({ name: 'Sol Ring', set: 'c21', collectorNumber: '263' }),
      collectionEntry({ name: 'Island', set: 'lea', collectorNumber: '288' }),
    ]
    expect(collectionToText(entries)).toBe('2 Sol Ring (C21:263)\n1 Island (LEA:288)')
  })

  test('keeps differing finishes as separate lines', () => {
    const entries = [collectionEntry({ finish: 'foil' }), collectionEntry({ finish: 'nonfoil' })]
    expect(collectionToText(entries)).toBe('1 Lightning Bolt (LEA:161)\n1 Lightning Bolt (LEA:161)')
  })

  test('does not merge copies of the same printing in different conditions', () => {
    const entries = [collectionEntry({ condition: 'NM' }), collectionEntry({ condition: 'LP' })]
    expect(collectionToText(entries)).toBe('1 Lightning Bolt (LEA:161)\n1 Lightning Bolt (LEA:161)')
  })
})

describe('wantedToText', () => {
  test('emits one line per entry at quantity 1', () => {
    const entries = [
      wantedEntry(),
      wantedEntry({ name: 'Sol Ring', set: 'c21', collectorNumber: '263' }),
    ]
    expect(wantedToText(entries)).toBe('1 Mana Crypt (2XM:1)\n1 Sol Ring (C21:263)')
  })

  test('omits the printing suffix for a name-only entry', () => {
    expect(
      wantedToText([
        wantedEntry({ set: undefined, collectorNumber: undefined, state: 'name-only' }),
      ]),
    ).toBe('1 Mana Crypt')
  })
})

describe('wantedToCsv', () => {
  test('starts with the canonical header and leaves the condition column blank', () => {
    const csv = wantedToCsv([wantedEntry({ finish: 'foil' })])
    expect(csv.split('\n')[0]).toBe(CSV_HEADER)
    expect(csv.split('\n')[1]).toBe('Mana Crypt,2XM,1,foil,,1')
  })

  test('quotes names with commas and blanks set/CN for name-only entries', () => {
    const csv = wantedToCsv([
      wantedEntry({ name: 'Krenko, Mob Boss', set: undefined, collectorNumber: undefined }),
    ])
    expect(csv.split('\n')[1]).toBe('"Krenko, Mob Boss",,,,,1')
  })
})

describe('deckToCsv', () => {
  const deck: DeckData = {
    name: 'Test',
    sections: [
      { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
      {
        name: 'Main',
        cards: [
          { quantity: 3, name: 'Forest', set: 'lea', collectorNumber: '294', finish: 'foil' },
          { quantity: 2, name: 'Plains', set: 'lea', collectorNumber: '290', finish: 'nonfoil' },
          { quantity: 1, name: 'Sol Ring' },
        ],
      },
    ],
  }

  test('emits one row per card line using the line quantity', () => {
    const lines = deckToCsv(deck).split('\n')
    expect(lines[0]).toBe(CSV_HEADER)
    expect(lines[1]).toBe('Atraxa,,,,,1')
    expect(lines[2]).toBe('Forest,LEA,294,foil,,3')
    // The default nonfoil finish is left blank in the CSV.
    expect(lines[3]).toBe('Plains,LEA,290,,,2')
    expect(lines[4]).toBe('Sol Ring,,,,,1')
  })
})

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
  test('starts with the canonical header and writes set uppercased, finish/condition, and a summed quantity', () => {
    const cards = [
      selected({ key: 'a', finish: 'foil', condition: 'LP', quantity: 1 }),
      selected({ key: 'b', finish: 'foil', condition: 'LP', quantity: 1 }),
    ]
    const lines = selectionToCsv(cards).split('\n')
    expect(lines[0]).toBe(CSV_HEADER)
    expect(lines[1]).toBe('Lightning Bolt,LEA,161,foil,LP,2')
  })

  test('leaves set and collector-number columns blank for a name-only card', () => {
    const card = selected({ set: undefined, collectorNumber: undefined })
    expect(selectionToCsv([card]).split('\n')[1]).toBe('Lightning Bolt,,,,,1')
  })
})
