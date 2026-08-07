import { describe, expect, it } from 'bun:test'
import {
  applyChangeToCollection,
  findCollectionPrintingError,
  toCollectionCardEntries,
} from '../../src/editor/collection-changes'
import type { CollectionCardEntry } from '../../src/site/data-types'
import { runMissMatrix, type MissMatrixCase } from '../test-utils'

function makeEntry(overrides: Partial<CollectionCardEntry> = {}): CollectionCardEntry {
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

describe('applyChangeToCollection', () => {
  it('add — adds a new entry to the end with correct fields', () => {
    const entries: CollectionCardEntry[] = [makeEntry()]
    const result = applyChangeToCollection(entries, {
      action: 'add',
      cardName: 'Dark Ritual',
    })

    expect(result).toHaveLength(2)
    expect(result[1]!.name).toBe('Dark Ritual')
    expect(result[1]!.price).toBe(0)
    expect(result[1]!.fileOrder).toBe(1)
  })

  it('add with printing options — set, collectorNumber, finish, condition are all populated', () => {
    const result = applyChangeToCollection([], {
      action: 'add',
      cardName: 'Tarmogoyf',
      set: 'fut',
      collectorNumber: '153',
      finish: 'foil',
      condition: 'LP',
    })

    expect(result).toHaveLength(1)
    const entry = result[0]!
    expect(entry.name).toBe('Tarmogoyf')
    expect(entry.set).toBe('fut')
    expect(entry.collectorNumber).toBe('153')
    expect(entry.finish).toBe('foil')
    expect(entry.condition).toBe('LP')
  })

  it('remove — removes the first matching entry by name', () => {
    const entries = [makeEntry(), makeEntry({ name: 'Dark Ritual', fileOrder: 1 })]
    const result = applyChangeToCollection(entries, {
      action: 'remove',
      cardName: 'Lightning Bolt',
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Dark Ritual')
  })

  it('remove non-existent — returns unchanged array', () => {
    const entries = [makeEntry()]
    const result = applyChangeToCollection(entries, {
      action: 'remove',
      cardName: 'Ancestral Recall',
    })

    expect(result).toBe(entries)
  })

  it('set-finish — updates finish on matching entry', () => {
    const entries = [makeEntry({ finish: 'nonfoil' })]
    const result = applyChangeToCollection(entries, {
      action: 'set-finish',
      cardName: 'Lightning Bolt',
      finish: 'foil',
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.finish).toBe('foil')
  })

  it('add with language — the new entry carries it; a bare add resolves to en', () => {
    const result = applyChangeToCollection([], {
      action: 'add',
      cardName: 'Ambition’s Cost',
      set: 'neo',
      collectorNumber: '234',
      language: 'ja',
    })
    expect(result[0]!.language).toBe('ja')

    const bare = applyChangeToCollection([], { action: 'add', cardName: 'Sol Ring' })
    expect(bare[0]!.language).toBe('en')
  })

  it('set-language — updates the targeted entry', () => {
    const entries = [makeEntry({ cardId: 5, language: 'en' })]
    const result = applyChangeToCollection(entries, {
      action: 'set-language',
      cardName: 'Lightning Bolt',
      cardId: 5,
      language: 'ja',
    })
    expect(result[0]!.language).toBe('ja')
    // Back to English — the resolved in-memory shape keeps the explicit en.
    const restored = applyChangeToCollection(result, {
      action: 'set-language',
      cardName: 'Lightning Bolt',
      cardId: 5,
      language: 'en',
    })
    expect(restored[0]!.language).toBe('en')
  })

  it('set-language — misses when no entry matches', () => {
    const entries = [makeEntry()]
    let missed = ''
    const result = applyChangeToCollection(
      entries,
      { action: 'set-language', cardName: 'Ancestral Recall', language: 'ja' },
      { onMiss: (reason) => (missed = reason) },
    )
    expect(result).toBe(entries)
    expect(missed).toBe('no-target')
  })

  it('set-printing — retargets the entry by cardId to the new printing', () => {
    const entries = [
      makeEntry({
        cardId: 5,
        set: 'lea',
        collectorNumber: '161',
        finish: 'nonfoil',
        condition: 'NM',
      }),
    ]
    const result = applyChangeToCollection(entries, {
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      cardId: 5,
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
      condition: 'LP',
    })

    expect(result).toHaveLength(1)
    const entry = result[0]!
    expect(entry.set).toBe('m10')
    expect(entry.collectorNumber).toBe('146')
    expect(entry.finish).toBe('foil')
    expect(entry.condition).toBe('LP')
  })

  it('set-printing — preserves existing finish/condition when the change omits them', () => {
    const entries = [makeEntry({ cardId: 5, finish: 'foil', condition: 'LP' })]
    const result = applyChangeToCollection(entries, {
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      cardId: 5,
      set: 'm10',
      collectorNumber: '146',
    })

    expect(result[0]!.set).toBe('m10')
    expect(result[0]!.finish).toBe('foil')
    expect(result[0]!.condition).toBe('LP')
  })

  it('set-printing — only the cardId-matched entry of a duplicate group changes', () => {
    const entries = [
      makeEntry({ cardId: 1, fileOrder: 0 }),
      makeEntry({ cardId: 2, fileOrder: 1 }),
      makeEntry({ cardId: 3, fileOrder: 2 }),
    ]
    const result = applyChangeToCollection(entries, {
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      cardId: 2,
      set: 'm10',
      collectorNumber: '146',
      finish: 'nonfoil',
      condition: 'NM',
    })

    expect(result[0]!.set).toBe('lea')
    expect(result[1]!.set).toBe('m10')
    expect(result[2]!.set).toBe('lea')
  })

  it('set-note — sets the note on the matching entry', () => {
    const entries = [makeEntry({ cardId: 5 })]
    const result = applyChangeToCollection(entries, {
      action: 'set-note',
      cardName: 'Lightning Bolt',
      cardId: 5,
      note: 'first edition',
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.note).toBe('first edition')
  })

  it('set-note — empty string clears the note', () => {
    const entries = [makeEntry({ cardId: 5, note: 'old note' })]
    const result = applyChangeToCollection(entries, {
      action: 'set-note',
      cardName: 'Lightning Bolt',
      cardId: 5,
      note: '',
    })
    expect(result[0]!.note).toBeUndefined()
  })

  it('set-commander — returns unchanged array (no-op for collections)', () => {
    const entries = [makeEntry()]
    const result = applyChangeToCollection(entries, {
      action: 'set-commander',
      cardName: 'Lightning Bolt',
    })

    expect(result).toBe(entries)
  })

  it('remove by fileOrder — targets the exact entry among duplicates', () => {
    const entries = [
      makeEntry({ name: 'Sheltered by Ghosts', set: 'dsk', collectorNumber: '30', fileOrder: 0 }),
      makeEntry({ name: 'Sheltered by Ghosts', set: 'dsk', collectorNumber: '30', fileOrder: 1 }),
      makeEntry({ name: 'Sheltered by Ghosts', set: 'dsk', collectorNumber: '30', fileOrder: 2 }),
    ]

    const result = applyChangeToCollection(entries, {
      action: 'remove',
      cardName: 'Sheltered by Ghosts',
      set: 'dsk',
      collectorNumber: '30',
      fileOrder: 1,
    })

    expect(result).toHaveLength(2)
    expect(result[0]!.fileOrder).toBe(0)
    expect(result[1]!.fileOrder).toBe(2)
  })

  it('add copy — duplicate printing appends a second entry, never merges like deck add', () => {
    const entries = [
      makeEntry({
        name: 'Arahbo, the First Fang',
        set: 'fdn',
        collectorNumber: '294',
        finish: 'foil',
        condition: 'LP',
        fileOrder: 0,
      }),
    ]

    const result = applyChangeToCollection(entries, {
      action: 'add',
      cardName: 'Arahbo, the First Fang',
      set: 'fdn',
      collectorNumber: '294',
      finish: 'foil',
      condition: 'LP',
    })

    expect(result).toHaveLength(2)
    const copy = result[1]!
    expect(copy.name).toBe('Arahbo, the First Fang')
    expect(copy.set).toBe('fdn')
    expect(copy.collectorNumber).toBe('294')
    expect(copy.finish).toBe('foil')
    expect(copy.condition).toBe('LP')
    expect(copy.fileOrder).toBe(1)
  })

  it('move-from — removes the matched entry (behaves like remove)', () => {
    const entries = [makeEntry({ cardId: 1 }), makeEntry({ name: 'Dark Ritual', cardId: 2 })]
    const result = applyChangeToCollection(entries, {
      action: 'move-from',
      cardName: 'Lightning Bolt',
      cardId: 1,
      set: 'lea',
      collectorNumber: '161',
      to: { type: 'deck', name: 'Burn' },
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Dark Ritual')
  })

  it('move-to — adds the card (behaves like add)', () => {
    const result = applyChangeToCollection([], {
      action: 'move-to',
      cardName: 'Tarmogoyf',
      set: 'fut',
      collectorNumber: '153',
      finish: 'foil',
      from: { type: 'deck', name: 'Jund' },
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Tarmogoyf')
    expect(result[0]!.set).toBe('fut')
    expect(result[0]!.finish).toBe('foil')
  })
})

describe('findCollectionPrintingError', () => {
  it('accepts a change list whose adds and printings are fully specified', () => {
    const error = findCollectionPrintingError([
      { action: 'add', cardName: 'Sol Ring', set: 'c21', collectorNumber: '167' },
      {
        action: 'move-to',
        cardName: 'Tarmogoyf',
        set: 'fut',
        collectorNumber: '153',
        from: { type: 'deck', name: 'Jund' },
      },
      { action: 'set-printing', cardName: 'Sol Ring', set: 'ltc', collectorNumber: '284' },
    ])
    expect(error).toBeNull()
  })

  it('rejects an add missing its printing, naming the card', () => {
    const error = findCollectionPrintingError([{ action: 'add', cardName: 'Sol Ring' }])
    expect(error).toBe('Cannot add "Sol Ring" to a collection without set and collector number')
  })

  it('rejects an add with a set but no collector number', () => {
    const error = findCollectionPrintingError([{ action: 'add', cardName: 'Sol Ring', set: 'c21' }])
    expect(error).toBe('Cannot add "Sol Ring" to a collection without set and collector number')
  })

  it('rejects a move-to missing its printing', () => {
    const error = findCollectionPrintingError([
      { action: 'move-to', cardName: 'Tarmogoyf', from: { type: 'deck', name: 'Jund' } },
    ])
    expect(error).toBe('Cannot add "Tarmogoyf" to a collection without set and collector number')
  })

  it('rejects a set-printing missing its printing, with its own wording', () => {
    const error = findCollectionPrintingError([
      { action: 'set-printing', cardName: 'Sol Ring', cardId: 5 },
    ])
    expect(error).toBe('Cannot set printing on "Sol Ring" without set and collector number')
  })

  it('ignores actions that never carry a printing', () => {
    const error = findCollectionPrintingError([
      { action: 'remove', cardName: 'Sol Ring' },
      { action: 'set-note', cardName: 'Sol Ring', note: 'binder' },
      { action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' },
      { action: 'add-section', section: 'Foils' },
      {
        action: 'move-from',
        cardName: 'Sol Ring',
        to: { type: 'deck', name: 'Burn' },
      },
    ])
    expect(error).toBeNull()
  })
})

describe('applyChangeToCollection — onMiss reporting', () => {
  type CollectionChange = Parameters<typeof applyChangeToCollection>[1]
  const cases: MissMatrixCase<CollectionChange>[] = [
    ['remove of an absent entry misses', { action: 'remove', cardName: 'Sol Ring' }, 'no-target'],
    [
      'remove with a wrong-case name misses (matching is case-sensitive)',
      { action: 'remove', cardName: 'lightning bolt' },
      'no-target',
    ],
    ['remove of a present entry applies', { action: 'remove', cardName: 'Lightning Bolt' }, null],
    [
      // Documents the deliberate 3-tier fallback: a stale cardId with a valid
      // name resolves at the name tier.
      'remove with a stale cardId and a valid name applies via the name tier',
      { action: 'remove', cardName: 'Lightning Bolt', cardId: 999 },
      null,
    ],
    [
      // fileOrder is tier 2 and terminal: when present and unmatched, the
      // change misses even though the name would have matched.
      'remove with a stale fileOrder misses even when the name matches',
      { action: 'remove', cardName: 'Lightning Bolt', fileOrder: 99 },
      'no-target',
    ],
    [
      'set-finish on an absent entry misses',
      { action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' },
      'no-target',
    ],
    [
      'set-printing on an absent entry misses',
      { action: 'set-printing', cardName: 'Sol Ring', set: 'c21', collectorNumber: '1' },
      'no-target',
    ],
    [
      'set-note on an absent entry misses',
      { action: 'set-note', cardName: 'Sol Ring', note: 'x' },
      'no-target',
    ],
    [
      'set-section on an absent entry misses',
      { action: 'set-section', cardName: 'Sol Ring', section: 'Box' },
      'no-target',
    ],
    [
      'move-from of an absent entry misses',
      { action: 'move-from', cardName: 'Sol Ring', to: { type: 'deck', name: 'd' } },
      'no-target',
    ],
    [
      'set-commander never applies to a collection and reports not-applicable',
      { action: 'set-commander', cardName: 'Lightning Bolt' },
      'not-applicable',
    ],
    [
      'add never misses',
      { action: 'add', cardName: 'Sol Ring', set: 'c21', collectorNumber: '1' },
      null,
    ],
  ]

  runMissMatrix(applyChangeToCollection, () => [makeEntry()], cases)
})

describe('toCollectionCardEntries', () => {
  it('resolves language like finish/condition: a bare entry reads as en, a token is kept', () => {
    const entries = toCollectionCardEntries([
      { name: 'Sol Ring', set: 'C21', collectorNumber: '1' },
      { name: 'Ambition’s Cost', set: 'neo', collectorNumber: '234', language: 'ja' },
    ])
    expect(entries[0]!.language).toBe('en')
    expect(entries[1]!.language).toBe('ja')
  })
})
