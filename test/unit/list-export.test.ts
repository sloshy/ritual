import { describe, expect, test } from 'bun:test'
import {
  CSV_HEADER,
  collectionToMarkdown,
  collectionToCsv,
  collectionToText,
  wantedToText,
  wantedToCsv,
  deckToCsv,
  frontMatterFor,
  withFrontMatter,
} from '../../src/list/list-export'
import { selectionToText, selectionToCsv } from '../../src/list-view/selection-export'
import { readFrontMatterMapping } from '../../src/list/front-matter-write'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/list/site-data'
import type { SelectedCard } from '../../src/list-view/useCardSelection'
import type { DeckData } from '../../src/list/deck'
import { makeCollectionEntry, makeSelectedCard } from '../test-utils'

const BOLT = { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' } as const

const collectionEntry = (overrides: Partial<CollectionCardEntry> = {}): CollectionCardEntry =>
  makeCollectionEntry({ ...BOLT, ...overrides })

const selected = (overrides: Partial<SelectedCard> = {}): SelectedCard =>
  makeSelectedCard({ ...BOLT, sourceName: 'My List', sourceKind: 'collection', ...overrides })

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

describe('collectionToMarkdown', () => {
  test('id-less entries are written with distinct &N ids', () => {
    // Two copies of one card is the case that matters: without ids they share a
    // `moveCardKey`, and only one of them could ever be moved or removed.
    const markdown = collectionToMarkdown(
      'Binder',
      [collectionEntry(), collectionEntry({ fileOrder: 1 })],
      ['Main'],
    )
    expect(markdown).toContain('&1')
    expect(markdown).toContain('&2')
  })

  test('an entry repeating an id already in the list does not produce two &5 lines', () => {
    // A change bundle replayed onto a list, or a `move-to` carrying the id the
    // card had in its source list, can hand the serializer a collision.
    const markdown = collectionToMarkdown(
      'Binder',
      [
        collectionEntry({ cardId: 5 }),
        collectionEntry({ name: 'Sol Ring', collectorNumber: '240', cardId: 5, fileOrder: 1 }),
      ],
      ['Main'],
    )
    expect(markdown.match(/&5\b/g)).toHaveLength(1)
    expect(markdown).toContain('Sol Ring')
  })
})

describe('frontMatterFor', () => {
  // The browser rebuilds this block by hand — there is no YAML dumper on the
  // download path — so what it emits has to parse back to what it was given, or
  // a downloaded list re-imports with a cover it never had.
  const roundTrip = (
    fields: Parameters<typeof frontMatterFor>[0],
  ): Record<string, unknown> | undefined => {
    const block = frontMatterFor(fields)
    if (!block) return undefined
    const parsed = readFrontMatterMapping(withFrontMatter(block, '# Binder\n'))
    if (!parsed.ok) throw new Error(`front matter unreadable: ${parsed.reason}`)
    return parsed.data
  }

  test('nothing to write is no block at all', () => {
    expect(frontMatterFor({})).toBeUndefined()
    expect(frontMatterFor({ labels: [] })).toBeUndefined()
  })

  test('a card cover round-trips as the mapping form', () => {
    expect(roundTrip({ image: { card: 12 } })).toEqual({ image: { card: 12 } })
  })

  test('a file cover round-trips with its path quoted', () => {
    expect(roundTrip({ image: { file: "alters/it's here.png" } })).toEqual({
      image: { file: "alters/it's here.png" },
    })
  })

  test('labels and a url cover are emitted together', () => {
    expect(roundTrip({ labels: ['sale'], image: { url: 'https://e.test/a.png' } })).toEqual({
      labels: ['sale'],
      image: { url: 'https://e.test/a.png' },
    })
  })

  test('a description round-trips even when the prose looks like YAML', () => {
    // Free prose is the one field here that could open a mapping, a comment or
    // a block scalar, which is why it is written double-quoted.
    for (const description of [
      'Trades: only #1 picks - see below',
      'She said "hi" \\ then left',
      '{W}{U} control, on a budget',
      // Emitted as an escaped \n on one physical line, decoded back by YAML.
      'Line one\n\nLine two',
    ]) {
      expect(roundTrip({ description })).toEqual({ description })
    }
  })

  test('a description is emitted beside the labels and the cover', () => {
    expect(roundTrip({ description: 'My binder', labels: ['sale'], image: { card: 12 } })).toEqual({
      description: 'My binder',
      labels: ['sale'],
      image: { card: 12 },
    })
  })
})

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
    expect(csv.split('\n')[1]).toBe('Mana Crypt,2XM,1,foil,,,1')
  })

  test('quotes names with commas and blanks set/CN for name-only entries', () => {
    const csv = wantedToCsv([
      wantedEntry({ name: 'Krenko, Mob Boss', set: undefined, collectorNumber: undefined }),
    ])
    expect(csv.split('\n')[1]).toBe('"Krenko, Mob Boss",,,,,,1')
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
    expect(lines[1]).toBe('Atraxa,,,,,,1')
    expect(lines[2]).toBe('Forest,LEA,294,foil,,,3')
    // The default nonfoil finish is left blank in the CSV.
    expect(lines[3]).toBe('Plains,LEA,290,,,,2')
    expect(lines[4]).toBe('Sol Ring,,,,,,1')
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
    expect(lines[1]).toBe('Lightning Bolt,LEA,161,foil,LP,,2')
  })

  test('leaves set and collector-number columns blank for a name-only card', () => {
    const card = selected({ set: undefined, collectorNumber: undefined })
    expect(selectionToCsv([card]).split('\n')[1]).toBe('Lightning Bolt,,,,,,1')
  })
})

describe('language column and token', () => {
  test('CSV_HEADER carries the Language column between Condition and Quantity', () => {
    expect(CSV_HEADER).toBe('Name,Set,Collector Number,Finish,Condition,Language,Quantity')
  })

  test('collection markdown writes [ja] and never [en]', () => {
    const markdown = collectionToMarkdown(
      'Binder',
      [
        collectionEntry({ language: 'ja', cardId: 1 }),
        collectionEntry({ name: 'Sol Ring', language: 'en', cardId: 2, fileOrder: 1 }),
        collectionEntry({ name: 'Brainstorm', cardId: 3, fileOrder: 2 }),
      ],
      ['Main'],
    )
    expect(markdown).toContain('- Lightning Bolt (LEA:161) [ja] &1')
    expect(markdown).toContain('- Sol Ring (LEA:161) &2')
    expect(markdown).toContain('- Brainstorm (LEA:161) &3')
    expect(markdown).not.toContain('[en]')
  })

  test('collection CSV emits the code, blank for en and missing languages', () => {
    const csv = collectionToCsv([
      collectionEntry({ language: 'ja' }),
      collectionEntry({ name: 'Sol Ring', language: 'en', fileOrder: 1 }),
      collectionEntry({ name: 'Brainstorm', fileOrder: 2 }),
    ])
    const lines = csv.split('\n')
    expect(lines[1]).toBe('Lightning Bolt,LEA,161,nonfoil,NM,ja,1')
    expect(lines[2]).toBe('Sol Ring,LEA,161,nonfoil,NM,,1')
    expect(lines[3]).toBe('Brainstorm,LEA,161,nonfoil,NM,,1')
  })

  test('wanted CSV emits the language code column', () => {
    const csv = wantedToCsv([wantedEntry({ language: 'zht' })])
    expect(csv.split('\n')[1]).toBe('Mana Crypt,2XM,1,,,zht,1')
  })

  test('language is an aggregation dimension: ja and bare copies never merge', () => {
    const csv = collectionToCsv([
      collectionEntry({ language: 'ja' }),
      collectionEntry({ fileOrder: 1 }),
      collectionEntry({ language: 'ja', fileOrder: 2 }),
    ])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('Lightning Bolt,LEA,161,nonfoil,NM,ja,2')
    expect(lines[2]).toBe('Lightning Bolt,LEA,161,nonfoil,NM,,1')
  })

  test('an explicit en folds together with a bare line when aggregating', () => {
    const csv = collectionToCsv([
      collectionEntry({ language: 'en' }),
      collectionEntry({ fileOrder: 1 }),
    ])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('Lightning Bolt,LEA,161,nonfoil,NM,,2')
  })

  test('selection CSV carries the selected card language', () => {
    const csv = selectionToCsv([selected({ language: 'ja', quantity: 2 })])
    expect(csv.split('\n')[1]).toBe('Lightning Bolt,LEA,161,,,ja,2')
  })
})
