import { describe, expect, test } from 'bun:test'
import {
  computeDeckSaveEffects,
  computeEntrySaveEffects,
  type EffectEntry,
} from '../../src/editor/save-effects'
import type { Card, DeckData } from '../../src/types'

type SectionSpec = [name: string, cards: Card[]]

function deck(...sections: SectionSpec[]): DeckData {
  return { name: 'Test', sections: sections.map(([name, cards]) => ({ name, cards })) }
}

describe('computeDeckSaveEffects', () => {
  test('reports an added line with the id the save allocated', () => {
    const before = deck(['Main', [{ quantity: 1, name: 'Sol Ring', cardId: 1 }]])
    const after = deck([
      'Main',
      [
        { quantity: 1, name: 'Sol Ring', cardId: 1 },
        { quantity: 1, name: 'Lightning Bolt', cardId: 2, set: 'lea', collectorNumber: '161' },
      ],
    ])
    expect(computeDeckSaveEffects({ before, after })).toEqual([
      {
        action: 'added',
        cardId: 2,
        name: 'Lightning Bolt',
        section: 'Main',
        quantity: 1,
        printing: { set: 'lea', collectorNumber: '161' },
      },
    ])
  })

  test('reports a removed line', () => {
    const before = deck([
      'Main',
      [
        { quantity: 1, name: 'Sol Ring', cardId: 1 },
        { quantity: 1, name: 'Bolt', cardId: 2 },
      ],
    ])
    const after = deck(['Main', [{ quantity: 1, name: 'Sol Ring', cardId: 1 }]])
    const effects = computeDeckSaveEffects({ before, after })
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ action: 'removed', cardId: 2, name: 'Bolt' })
  })

  test('a quantity change is an update carrying the post-save quantity', () => {
    const before = deck(['Main', [{ quantity: 1, name: 'Island', cardId: 1 }]])
    const after = deck(['Main', [{ quantity: 3, name: 'Island', cardId: 1 }]])
    expect(computeDeckSaveEffects({ before, after })).toEqual([
      { action: 'updated', cardId: 1, name: 'Island', section: 'Main', quantity: 3 },
    ])
  })

  test('a note-only edit reports an update, and the note is not echoed', () => {
    const before = deck(['Main', [{ quantity: 1, name: 'Island', cardId: 1 }]])
    const after = deck(['Main', [{ quantity: 1, name: 'Island', cardId: 1, note: 'signed' }]])
    const effects = computeDeckSaveEffects({ before, after })
    expect(effects).toHaveLength(1)
    expect(effects[0]!.action).toBe('updated')
    expect(Object.keys(effects[0]!).sort()).toEqual([
      'action',
      'cardId',
      'name',
      'quantity',
      'section',
    ])
  })

  test('two edits that would cancel under a delimiter-joined key still report one update', () => {
    // "Fire // Ice" + note "" and "Fire" + note "// Ice" concatenate identically;
    // only a structurally-encoded signature tells them apart.
    const before = deck(['Main', [{ quantity: 1, name: 'Fire // Ice', cardId: 1 }]])
    const after = deck(['Main', [{ quantity: 1, name: 'Fire', cardId: 1, note: '// Ice' }]])
    expect(computeDeckSaveEffects({ before, after }).map((e) => e.action)).toEqual([
      'added',
      'removed',
    ])
  })

  test('a case-only set-code normalization is not a change', () => {
    // Set codes are compared lowercased on both sides, so re-serializing a file
    // whose codes were stored upper-case must not report every line as edited.
    const before = deck(['Main', [{ quantity: 1, name: 'Sol Ring', cardId: 1, set: 'C19' }]])
    const after = deck(['Main', [{ quantity: 1, name: 'Sol Ring', cardId: 1, set: 'c19' }]])
    expect(computeDeckSaveEffects({ before, after })).toEqual([])
  })

  test('moving a line to another section is an update naming the new section', () => {
    const before = deck(['Main', [{ quantity: 1, name: 'Island', cardId: 1 }]])
    const after = deck(['Main', []], ['Sideboard', [{ quantity: 1, name: 'Island', cardId: 1 }]])
    expect(computeDeckSaveEffects({ before, after })).toEqual([
      { action: 'updated', cardId: 1, name: 'Island', section: 'Sideboard', quantity: 1 },
    ])
  })

  test('an untouched deck reports nothing', () => {
    const before = deck(['Main', [{ quantity: 1, name: 'Island', cardId: 1 }]])
    expect(computeDeckSaveEffects({ before, after: before })).toEqual([])
  })

  test('orders added, then updated, then removed', () => {
    const before = deck([
      'Main',
      [
        { quantity: 1, name: 'Gone', cardId: 1 },
        { quantity: 1, name: 'Changed', cardId: 2 },
      ],
    ])
    const after = deck([
      'Main',
      [
        { quantity: 2, name: 'Changed', cardId: 2 },
        { quantity: 1, name: 'New', cardId: 3 },
      ],
    ])
    expect(computeDeckSaveEffects({ before, after }).map((e) => e.action)).toEqual([
      'added',
      'updated',
      'removed',
    ])
  })
})

describe('computeEntrySaveEffects', () => {
  test('flat entries report one copy per line and a lowercase set code', () => {
    const before: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221' },
    ]
    const after: EffectEntry[] = [
      ...before,
      { cardId: 2, name: 'Bolt', set: 'LEA', collectorNumber: '161', finish: 'foil' },
    ]
    expect(computeEntrySaveEffects({ before, after })).toEqual([
      {
        action: 'added',
        cardId: 2,
        name: 'Bolt',
        quantity: 1,
        printing: { set: 'lea', collectorNumber: '161', finish: 'foil' },
      },
    ])
  })

  test('a printing change on the same id is an update', () => {
    const before: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221' },
    ]
    const after: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring', set: 'lcc', collectorNumber: '327' },
    ]
    expect(computeEntrySaveEffects({ before, after })).toEqual([
      {
        action: 'updated',
        cardId: 1,
        name: 'Sol Ring',
        quantity: 1,
        printing: { set: 'lcc', collectorNumber: '327' },
      },
    ])
  })

  test('a condition regrade is an update echoing the new condition', () => {
    const before: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', condition: 'NM' },
    ]
    const after: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', condition: 'LP' },
    ]
    expect(computeEntrySaveEffects({ before, after })).toEqual([
      {
        action: 'updated',
        cardId: 1,
        name: 'Sol Ring',
        quantity: 1,
        printing: { set: 'c19', collectorNumber: '221', condition: 'LP' },
      },
    ])
  })

  test('a section move is an update naming the new section', () => {
    const before: EffectEntry[] = [{ cardId: 1, name: 'Sol Ring', section: 'Binder' }]
    const after: EffectEntry[] = [{ cardId: 1, name: 'Sol Ring', section: 'Long Box' }]
    expect(computeEntrySaveEffects({ before, after })).toEqual([
      { action: 'updated', cardId: 1, name: 'Sol Ring', section: 'Long Box', quantity: 1 },
    ])
  })

  test('reports a removed entry', () => {
    const before: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring' },
      { cardId: 2, name: 'Bolt', set: 'lea', collectorNumber: '161' },
    ]
    const after: EffectEntry[] = [{ cardId: 1, name: 'Sol Ring' }]
    expect(computeEntrySaveEffects({ before, after })).toEqual([
      {
        action: 'removed',
        cardId: 2,
        name: 'Bolt',
        quantity: 1,
        printing: { set: 'lea', collectorNumber: '161' },
      },
    ])
  })

  test('reordering entries alone produces no effects', () => {
    // Effects are keyed by id, not by position, so a re-serialization that only
    // moves lines around must report nothing at all.
    const before: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring' },
      { cardId: 2, name: 'Bolt' },
    ]
    const after: EffectEntry[] = [before[1]!, before[0]!]
    expect(computeEntrySaveEffects({ before, after })).toEqual([])
  })

  test('an id the pool reused within one save reports a removal and an addition', () => {
    // The freed `&2` is handed straight to the new entry. Keyed by id alone this
    // reads as a single `updated`, and the caller is never told Bolt is gone.
    const before: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring' },
      { cardId: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
    ]
    const after: EffectEntry[] = [
      { cardId: 1, name: 'Sol Ring' },
      { cardId: 2, name: 'Counterspell', set: 'lea', collectorNumber: '55' },
    ]
    expect(computeEntrySaveEffects({ before, after })).toEqual([
      {
        action: 'added',
        cardId: 2,
        name: 'Counterspell',
        quantity: 1,
        printing: { set: 'lea', collectorNumber: '55' },
      },
      {
        action: 'removed',
        cardId: 2,
        name: 'Lightning Bolt',
        quantity: 1,
        printing: { set: 'lea', collectorNumber: '161' },
      },
    ])
  })

  test('a renumbered line is an update carrying the id it used to have', () => {
    // An arriving entry claimed `&2`, so the long-standing Bolt was pushed onto a
    // fresh id. Without the assignment report it would read as a brand-new card.
    const before: EffectEntry[] = [{ cardId: 2, name: 'Lightning Bolt', set: 'lea' }]
    const after: EffectEntry[] = [
      { cardId: 2, name: 'Counterspell', set: 'lea' },
      { cardId: 3, name: 'Lightning Bolt', set: 'lea' },
    ]
    expect(
      computeEntrySaveEffects({
        before,
        after,
        assignments: [{ cardId: 2 }, { cardId: 3, previousCardId: 2 }],
      }),
    ).toEqual([
      {
        action: 'added',
        cardId: 2,
        name: 'Counterspell',
        quantity: 1,
        printing: { set: 'lea' },
      },
      {
        action: 'updated',
        cardId: 3,
        name: 'Lightning Bolt',
        quantity: 1,
        printing: { set: 'lea' },
        previousCardId: 2,
      },
    ])
  })

  test('a renumbered id belonging to a different card does not claim the old entry', () => {
    // Same collision, but the arriving entry lost the race instead: identity is
    // what keeps its `previousCardId` from stealing Bolt's line.
    const before: EffectEntry[] = [{ cardId: 2, name: 'Lightning Bolt', set: 'lea' }]
    const after: EffectEntry[] = [
      { cardId: 2, name: 'Lightning Bolt', set: 'lea' },
      { cardId: 3, name: 'Counterspell', set: 'lea' },
    ]
    expect(
      computeEntrySaveEffects({
        before,
        after,
        assignments: [{ cardId: 2 }, { cardId: 3, previousCardId: 2 }],
      }),
    ).toEqual([
      { action: 'added', cardId: 3, name: 'Counterspell', quantity: 1, printing: { set: 'lea' } },
    ])
  })

  test('an entry with no id is not in the diff at all', () => {
    // Every list file is id-backfilled before a command runs, so an id-less
    // entry is not a case to defend against — it simply has no identity to key.
    const before: EffectEntry[] = [{ name: 'Sol Ring', set: 'c19' }]
    const after: EffectEntry[] = [{ name: 'Sol Ring', set: 'lcc', condition: 'LP' }]
    expect(computeEntrySaveEffects({ before, after })).toEqual([])
  })
})
