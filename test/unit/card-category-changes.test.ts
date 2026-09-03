import { describe, expect, test } from 'bun:test'
import {
  CATEGORY_ACTIONS,
  consolidateSetCategories,
  createRenameCategoryChange,
  createSetCategoriesChange,
  createSetCategoryOrderChange,
  formatChangeCore,
  isAdditiveChange,
  type ChangeEvent,
} from '../../src/changes/change-event'
import { decodeChangeEvent, encodeChangeEvent } from '../../src/changes/change-event-decode'
import { applyChangeToCollection } from '../../src/changes/collection-changes'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import { applyChangeToWantedList } from '../../src/changes/wanted-changes'
import { buildDefaultChangeEvents } from '../../src/changes/list-snapshot'
import {
  categoryChangesOf,
  emptyCardCategoriesRecord,
} from '../../src/list/card-categories-sidecar'
import { applyTargetedChangesToContent } from '../../src/list/line-mutate'
import type { DeckData } from '../../src/list/deck'
import type { EntryRef } from '../../src/list/entry-ref'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/list/site-data'
import { makeCollectionEntry } from '../test-utils'

/**
 * The category events end to end through the engine layer: how they consolidate,
 * how the JSON codec guards them, that every apply engine treats them as an
 * entry no-op (categories live in the sidecar, never on a line), and that the
 * line-preserving one-shot path leaves the content byte-identical.
 *
 * The vocabulary rules live in `card-categories.test.ts`, the sidecar's own
 * behaviour in `card-categories-sidecar.test.ts`.
 */

const WRITER = { tense: 'past', quoteCardName: true } as const
const PENDING = { tense: 'present', quoteCardName: true } as const

describe('creators', () => {
  test('canonicalize their values and carry no cardId at all', () => {
    const set = createSetCategoriesChange('Sol Ring', [' Ramp ', 'ramp', 'Card  Draw'])
    expect(set.categories).toEqual(['Ramp', 'Card Draw'])
    // `toEqual` ignores undefined-valued keys, so assert absence by key.
    expect(Object.keys(set).sort()).toEqual(['action', 'cardName', 'categories', 'id', 'timestamp'])

    const renamed = createRenameCategoryChange(' Draw ', 'Card  Draw')
    expect(renamed.category).toBe('Draw')
    expect(renamed.newCategory).toBe('Card Draw')
    expect(Object.keys(renamed)).not.toContain('cardId')
    expect(Object.keys(renamed)).not.toContain('cardName')

    const order = createSetCategoryOrderChange(['Ramp', 'ramp', 'Draw'])
    expect(order.order).toEqual(['Ramp', 'Draw'])
    expect(Object.keys(order)).not.toContain('cardName')
  })
})

describe('consolidateSetCategories', () => {
  test('a second edit of the same card replaces the pending event', () => {
    const first = consolidateSetCategories([], 'Sol Ring', ['Ramp'], undefined)
    const second = consolidateSetCategories(first.changes, 'Sol Ring', ['Ramp', 'Draw'], undefined)
    expect(second.changes).toHaveLength(1)
    expect(second.cancelledChange).toBe(first.addedChange)
    const only = second.changes[0]
    expect(only?.action === 'set-categories' && only.categories).toEqual(['Ramp', 'Draw'])
  })

  test('restoring the original records nothing and cancels the pending event', () => {
    const first = consolidateSetCategories([], 'Sol Ring', ['Draw'], ['Ramp'])
    const back = consolidateSetCategories(first.changes, 'Sol Ring', ['Ramp'], ['Ramp'])
    expect(back.changes).toEqual([])
    expect(back.addedChange).toBeNull()
    expect(back.cancelledChange).toBe(first.addedChange)
  })

  test('an order-only change IS a change — the first entry is the primary', () => {
    const result = consolidateSetCategories([], 'Sol Ring', ['Draw', 'Ramp'], ['Ramp', 'Draw'])
    expect(result.addedChange).not.toBeNull()
  })

  test('another card’s pending event is left alone', () => {
    const first = consolidateSetCategories([], 'Sol Ring', ['Ramp'], undefined)
    const second = consolidateSetCategories(first.changes, 'Brainstorm', ['Draw'], undefined)
    expect(second.changes).toHaveLength(2)
    expect(second.cancelledChange).toBeNull()
  })
})

describe('prose, colouring and codec', () => {
  test('formatChangeCore writes the persisted English in both tenses', () => {
    const set = createSetCategoriesChange('Sol Ring', ['Ramp', 'Artifacts'])
    expect(formatChangeCore(set, WRITER)).toBe('Set categories of "Sol Ring" to Ramp, Artifacts')
    expect(formatChangeCore(set, PENDING)).toBe('Set categories of "Sol Ring" to Ramp, Artifacts')

    const cleared = createSetCategoriesChange('Sol Ring', [])
    expect(formatChangeCore(cleared, WRITER)).toBe('Cleared categories of "Sol Ring"')
    expect(formatChangeCore(cleared, PENDING)).toBe('Clear categories of "Sol Ring"')

    const renamed = createRenameCategoryChange('Draw', 'Card Draw')
    expect(formatChangeCore(renamed, WRITER)).toBe('Renamed category "Draw" to "Card Draw"')
    expect(formatChangeCore(renamed, PENDING)).toBe('Rename category "Draw" to "Card Draw"')

    const order = createSetCategoryOrderChange(['Ramp', 'Draw'])
    expect(formatChangeCore(order, WRITER)).toBe('Set category order to Ramp, Draw')
    expect(formatChangeCore(order, PENDING)).toBe('Set category order to Ramp, Draw')
    expect(formatChangeCore(createSetCategoryOrderChange([]), WRITER)).toBe(
      'Cleared category order',
    )
  })

  test('all three actions read as additive', () => {
    expect(isAdditiveChange('set-categories')).toBe(true)
    expect(isAdditiveChange('rename-category')).toBe(true)
    expect(isAdditiveChange('set-category-order')).toBe(true)
  })

  test('decodeChangeEvent canonicalizes every category field', () => {
    const decoded = decodeChangeEvent(
      {
        id: 'a',
        timestamp: 1,
        action: 'set-categories',
        cardName: 'Sol Ring',
        categories: [' Ramp ', 'ramp', 'Card  Draw'],
      },
      'change 1: ',
    )
    expect(typeof decoded === 'string' ? decoded : decoded.action).toBe('set-categories')
    if (typeof decoded === 'string') return
    expect(decoded.action === 'set-categories' && decoded.categories).toEqual(['Ramp', 'Card Draw'])
  })

  test('a cardId is refused on every category action, and a cardName on the two list-level ones', () => {
    // `cardId` is in SERIALIZED_KEY_ORDER and the decoder keeps keys it does not
    // rewrite, so a smuggled id would be persisted into this list's changelog
    // prose — naming a line in some other list.
    expect(
      decodeChangeEvent(
        {
          id: 'a',
          timestamp: 1,
          action: 'set-categories',
          cardName: 'Sol Ring',
          cardId: 12,
          categories: ['Ramp'],
        },
        'change 1: ',
      ),
    ).toBe('change 1: (set-categories) is keyed by card name and must not carry a "cardId".')

    expect(
      decodeChangeEvent(
        { id: 'a', timestamp: 1, action: 'set-category-order', cardId: 3, order: ['Ramp'] },
        'change 1: ',
      ),
    ).toBe('change 1: (set-category-order) is keyed by card name and must not carry a "cardId".')

    expect(
      decodeChangeEvent(
        {
          id: 'a',
          timestamp: 1,
          action: 'rename-category',
          cardName: 'Sol Ring',
          category: 'Draw',
          newCategory: 'Card Draw',
        },
        'change 1: ',
      ),
    ).toBe(
      'change 1: (rename-category) targets the list, not a card, and must not carry a "cardName".',
    )
  })

  test('an empty categories array survives decoding — it is a clear', () => {
    const decoded = decodeChangeEvent(
      {
        id: 'a',
        timestamp: 1,
        action: 'set-categories',
        cardName: 'Sol Ring',
        categories: [],
      },
      'change 1: ',
    )
    expect(typeof decoded).not.toBe('string')
    if (typeof decoded === 'string') return
    expect(decoded.action === 'set-categories' && decoded.categories).toEqual([])
  })

  test.each([
    [
      'a non-array categories',
      { action: 'set-categories', cardName: 'Sol Ring', categories: 'Ramp' },
    ],
    [
      'a malformed category name',
      { action: 'set-categories', cardName: 'Sol Ring', categories: ['a,b'] },
    ],
    ['a missing required field', { action: 'set-categories', cardName: 'Sol Ring' }],
    ['a set-categories without a cardName', { action: 'set-categories', categories: ['Ramp'] }],
    ['a non-string category', { action: 'rename-category', category: 7, newCategory: 'B' }],
    ['a malformed rename target', { action: 'rename-category', category: 'A', newCategory: 'a,b' }],
    ['a non-array order', { action: 'set-category-order', order: 'Ramp' }],
  ])('decodeChangeEvent refuses %s', (_label, fields) => {
    expect(typeof decodeChangeEvent({ id: 'a', timestamp: 1, ...fields }, 'change 1: ')).toBe(
      'string',
    )
  })

  test('the two list-level actions decode with no cardName', () => {
    for (const fields of [
      { action: 'rename-category', category: 'Draw', newCategory: 'Card Draw' },
      { action: 'set-category-order', order: ['Ramp'] },
    ]) {
      expect(typeof decodeChangeEvent({ id: 'a', timestamp: 1, ...fields }, 'change 1: ')).not.toBe(
        'string',
      )
    }
  })

  test('encodeChangeEvent writes the fields in the declared key order', () => {
    expect(encodeChangeEvent(createSetCategoriesChange('Sol Ring', ['Ramp', 'Draw']))).toBe(
      '{"action":"set-categories","cardName":"Sol Ring","categories":["Ramp","Draw"]}',
    )
    expect(encodeChangeEvent(createRenameCategoryChange('Draw', 'Card Draw'))).toBe(
      '{"action":"rename-category","category":"Draw","newCategory":"Card Draw"}',
    )
    expect(encodeChangeEvent(createSetCategoryOrderChange(['Ramp', 'Draw']))).toBe(
      '{"action":"set-category-order","order":["Ramp","Draw"]}',
    )
  })
})

describe('CATEGORY_ACTIONS', () => {
  const CATEGORY_EVENTS: ChangeEvent[] = [
    createSetCategoriesChange('Sol Ring', ['Ramp']),
    createRenameCategoryChange('Draw', 'Card Draw'),
    createSetCategoryOrderChange(['Ramp', 'Card Draw']),
  ]

  test('names exactly the events the sidecar replays', () => {
    // The one enumeration: the sidecar's commit filter and the import
    // retargeter's untargeted set are both built from it, and neither is
    // compile-enforced on its own.
    expect([...CATEGORY_ACTIONS].map(String).sort()).toEqual(
      CATEGORY_EVENTS.map((event) => String(event.action)).sort(),
    )
    expect(categoryChangesOf(CATEGORY_EVENTS)).toHaveLength(CATEGORY_EVENTS.length)
    expect(
      categoryChangesOf([createSetCategoriesChange('Sol Ring', []), ...CATEGORY_EVENTS]),
    ).toHaveLength(CATEGORY_EVENTS.length + 1)
  })
})

describe('apply engines', () => {
  const CHANGES: ChangeEvent[] = [
    createSetCategoriesChange('Sol Ring', ['Ramp']),
    createRenameCategoryChange('Draw', 'Card Draw'),
    createSetCategoryOrderChange(['Ramp', 'Card Draw']),
  ]

  test('a collection, a wanted list and a deck are all left untouched, and nothing misses', () => {
    const entries: CollectionCardEntry[] = [
      makeCollectionEntry({ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }),
    ]
    const wanted: WantedListCardEntry[] = [
      { name: 'Sol Ring', section: 'Main', cardId: 1, price: 0, fileOrder: 0, state: 'name-only' },
    ]
    const deck: DeckData = {
      name: 'Burn',
      sections: [{ name: 'Main', cards: [{ name: 'Sol Ring', quantity: 1, cardId: 1 }] }],
    }
    let misses = 0
    const options = { onMiss: () => void misses++ }
    // Independent baselines: comparing a returned reference against the very
    // object handed in passes even if the engine mutated it in place.
    const entriesBefore = structuredClone(entries)
    const wantedBefore = structuredClone(wanted)
    const sectionsBefore = structuredClone(deck.sections)

    for (const change of CHANGES) {
      expect(applyChangeToCollection(entries, change, options)).toEqual(entriesBefore)
      expect(applyChangeToWantedList(wanted, change, options)).toEqual(wantedBefore)
      expect(applyChangeToDeck(deck, change, options).sections).toEqual(sectionsBefore)
    }
    expect(misses).toBe(0)
  })
})

describe('list snapshot', () => {
  const snapshot = {
    sectionOrder: ['Main'],
    entries: [
      { name: 'Sol Ring', quantity: 1, section: 'Main', isCommander: false, cardId: 1 },
      { name: 'Brainstorm', quantity: 1, section: 'Main', isCommander: false, cardId: 2 },
    ],
  }

  test('emits the order event then one set-categories per card, in data name order', () => {
    const categories = emptyCardCategoriesRecord()
    categories.order = ['Ramp', 'Draw']
    categories.cards.set('sol ring', { name: 'Sol Ring', categories: ['Ramp'] })
    categories.cards.set('brainstorm', { name: 'Brainstorm', categories: ['Draw'] })

    const events = buildDefaultChangeEvents(snapshot, categories)
    expect(
      events
        .filter((event) => event.action.includes('categor'))
        .map((event) => ('cardName' in event ? `${event.action}:${event.cardName}` : event.action)),
    ).toEqual(['set-category-order', 'set-categories:Brainstorm', 'set-categories:Sol Ring'])
  })

  test('emits nothing when the record is omitted or empty', () => {
    for (const categories of [undefined, emptyCardCategoriesRecord()]) {
      const events = buildDefaultChangeEvents(snapshot, categories)
      expect(events.filter((event) => event.action.includes('categor'))).toEqual([])
    }
  })
})

describe('line-preserving one-shot path', () => {
  const collection = ['# Binder', '', '- Sol Ring (C21:263) [foil] {shelf 2} &1', ''].join('\n')
  const solRing: EntryRef = {
    name: 'Sol Ring',
    set: 'c21',
    collectorNumber: '263',
    finish: 'foil',
    note: 'shelf 2',
    cardId: 1,
  }

  test('every category action leaves the content byte-identical', () => {
    for (const change of [
      createSetCategoriesChange('Sol Ring', ['Ramp']),
      createRenameCategoryChange('Draw', 'Card Draw'),
      createSetCategoryOrderChange(['Ramp']),
    ]) {
      expect(applyTargetedChangesToContent(collection, 'collection', solRing, [change])).toBe(
        collection,
      )
    }
  })
})
