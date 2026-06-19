import { describe, expect, it } from 'bun:test'
import { applyChangeToCollection } from '../../src/editor/collection-changes'
import type { CollectionCardEntry } from '../../src/site/data-types'

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

  it('remove by name + set — with set specified, only removes matching set', () => {
    const entries = [
      makeEntry({ set: 'lea', fileOrder: 0 }),
      makeEntry({ set: '2ed', fileOrder: 1 }),
    ]
    const result = applyChangeToCollection(entries, {
      action: 'remove',
      cardName: 'Lightning Bolt',
      set: '2ed',
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.set).toBe('lea')
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

  it('multiple adds then remove — add 2, remove 1, verify 1 remains', () => {
    let entries: CollectionCardEntry[] = []
    entries = applyChangeToCollection(entries, {
      action: 'add',
      cardName: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
    })
    entries = applyChangeToCollection(entries, {
      action: 'add',
      cardName: 'Dark Ritual',
      set: 'lea',
      collectorNumber: '104',
    })
    entries = applyChangeToCollection(entries, {
      action: 'remove',
      cardName: 'Lightning Bolt',
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Dark Ritual')
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

  it('remove by fileOrder — non-existent fileOrder returns unchanged', () => {
    const entries = [makeEntry({ fileOrder: 0 }), makeEntry({ fileOrder: 1 })]
    const result = applyChangeToCollection(entries, {
      action: 'remove',
      cardName: 'Lightning Bolt',
      fileOrder: 99,
    })

    expect(result).toBe(entries)
  })

  it('add copy — duplicates entry with same printing info', () => {
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
