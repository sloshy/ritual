import { describe, expect, it, test } from 'bun:test'
import {
  areOppositeChanges,
  consolidateTagEdits,
  createAddChange,
  createAddTagChange,
  createRemoveChange,
  createRemoveTagChange,
  formatChangeCore,
  isAdditiveChange,
  type ChangeEvent,
} from '../../src/changes/change-event'
import { decodeChangeEvent, encodeChangeEvent } from '../../src/changes/change-event-decode'
import { changeSetFromEvents, combineSetsInto } from '../../src/changes/changelog-blocks'
import { applyChangeToCollection } from '../../src/changes/collection-changes'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import { applyChangeToWantedList } from '../../src/changes/wanted-changes'
import { buildDefaultChangeEvents } from '../../src/changes/list-snapshot'
import { applyDeckAddToContent, applyTargetedChangesToContent } from '../../src/list/line-mutate'
import type { DeckData } from '../../src/list/deck'
import type { EntryRef } from '../../src/list/entry-ref'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/list/site-data'
import { makeCollectionEntry } from '../test-utils'

/**
 * The tag events end to end through the engine layer: how they cancel, how a
 * tag-set edit becomes per-tag events, how every apply engine and the
 * line-preserving one-shot path write them, and how the JSON codec guards them.
 * The card-line grammar's own reading of the tag token is pinned in
 * `card-line-grammar.test.ts`; the vocabulary rules in `card-tags.test.ts`.
 */

const makeEntry = (overrides: Partial<CollectionCardEntry> = {}): CollectionCardEntry =>
  makeCollectionEntry({
    name: 'Lightning Bolt',
    set: 'lea',
    collectorNumber: '161',
    cardId: 1,
    ...overrides,
  })

describe('areOppositeChanges — tags', () => {
  test('add-tag and remove-tag of the same tag on the same card cancel', () => {
    const add = createAddTagChange('Sol Ring', { tag: 'ramp', cardId: 3 })
    const remove = createRemoveTagChange('Sol Ring', { tag: 'ramp', cardId: 3 })
    expect(areOppositeChanges(add, remove)).toBe(true)
    expect(areOppositeChanges(remove, add)).toBe(true)
  })

  test('a different tag, card, or id is not an opposite', () => {
    const add = createAddTagChange('Sol Ring', { tag: 'ramp', cardId: 3 })
    expect(
      areOppositeChanges(add, createRemoveTagChange('Sol Ring', { tag: 'staple', cardId: 3 })),
    ).toBe(false)
    expect(
      areOppositeChanges(add, createRemoveTagChange('Arcane Signet', { tag: 'ramp', cardId: 3 })),
    ).toBe(false)
    expect(
      areOppositeChanges(add, createRemoveTagChange('Sol Ring', { tag: 'ramp', cardId: 4 })),
    ).toBe(false)
    // Two add-tags are never opposites, whatever they name.
    expect(
      areOppositeChanges(add, createAddTagChange('Sol Ring', { tag: 'ramp', cardId: 3 })),
    ).toBe(false)
  })

  test('tags are part of an add/remove pair’s identity', () => {
    const remove = createRemoveChange('Sol Ring', { cardId: 3, tags: ['ramp'] })
    expect(
      areOppositeChanges(remove, createAddChange('Sol Ring', { cardId: 3, tags: ['ramp'] })),
    ).toBe(true)
    expect(
      areOppositeChanges(remove, createAddChange('Sol Ring', { cardId: 3, tags: [' ramp '] })),
    ).toBe(true)
    expect(
      areOppositeChanges(remove, createAddChange('Sol Ring', { cardId: 3, tags: ['Ramp'] })),
    ).toBe(false)
    expect(areOppositeChanges(remove, createAddChange('Sol Ring', { cardId: 3 }))).toBe(false)
    expect(
      areOppositeChanges(remove, createAddChange('Sol Ring', { cardId: 3, tags: ['staple'] })),
    ).toBe(false)
  })
})

describe('consolidateTagEdits', () => {
  const actions = (changes: readonly ChangeEvent[]): string[] =>
    changes.map((c) => ('tag' in c ? `${c.action}:${c.tag}` : c.action))

  test('records one event per tag that changed, and nothing for tags left alone', () => {
    const result = consolidateTagEdits([], 'Sol Ring', ['ramp', 'zebra'], ['ramp', 'staple'], 3)
    expect(actions(result.changes)).toEqual(['add-tag:zebra', 'remove-tag:staple'])
    expect(result.addedChanges).toHaveLength(2)
    expect(result.cancelledChanges).toHaveLength(0)
  })

  test('adding a tag back after removing it in the session cancels the removal', () => {
    const first = consolidateTagEdits([], 'Sol Ring', [], ['ramp'], 3)
    expect(actions(first.changes)).toEqual(['remove-tag:ramp'])
    const second = consolidateTagEdits(first.changes, 'Sol Ring', ['ramp'], [], 3)
    expect(second.changes).toEqual([])
    expect(second.addedChanges).toEqual([])
    expect(second.cancelledChanges).toEqual(first.addedChanges)
  })

  test('removing a tag added in the session cancels the add, leaving unrelated events', () => {
    const other = createAddTagChange('Arcane Signet', { tag: 'ramp', cardId: 9 })
    const first = consolidateTagEdits([other], 'Sol Ring', ['ramp'], undefined, 3)
    const second = consolidateTagEdits(first.changes, 'Sol Ring', [], ['ramp'], 3)
    expect(second.changes).toEqual([other])
  })

  test('a no-op edit returns the changes untouched', () => {
    const pending = [createAddTagChange('Sol Ring', { tag: 'ramp', cardId: 3 })]
    const result = consolidateTagEdits(pending, 'Sol Ring', [' ramp '], ['ramp'], 3)
    expect(result.changes).toBe(pending)
    expect(result.addedChanges).toEqual([])
    expect(result.cancelledChanges).toEqual([])
  })
})

describe('prose, colouring and codec', () => {
  test('formatChangeCore quotes the tag in both tenses', () => {
    const add = createAddTagChange('Sol Ring', { tag: 'Ramp', cardId: 3 })
    const remove = createRemoveTagChange('Sol Ring', { tag: 'binder/trade' })
    expect(formatChangeCore(add, { tense: 'past', quoteCardName: true })).toBe(
      'Added tag "Ramp" to "Sol Ring" &3',
    )
    expect(formatChangeCore(add, { tense: 'present', quoteCardName: false })).toBe(
      'Add tag "Ramp" to Sol Ring &3',
    )
    expect(formatChangeCore(remove, { tense: 'past', quoteCardName: true })).toBe(
      'Removed tag "binder/trade" from "Sol Ring"',
    )
  })

  test('add-tag reads as a gain and remove-tag as a loss', () => {
    expect(isAdditiveChange('add-tag')).toBe(true)
    expect(isAdditiveChange('remove-tag')).toBe(false)
  })

  test('the creators canonicalize the tag, and an add/remove its tag set', () => {
    expect(createAddTagChange('Sol Ring', { tag: ' Card  Draw ' }).tag).toBe('Card Draw')
    expect(createRemoveTagChange('Sol Ring', { tag: ' Ramp' }).tag).toBe('Ramp')
    expect(createAddChange('Sol Ring', { tags: ['Zebra', 'apple', 'apple '] }).tags).toEqual([
      'apple',
      'Zebra',
    ])
    expect(createRemoveChange('Sol Ring', { tags: [] }).tags).toBeUndefined()
  })

  test('decodeChangeEvent canonicalizes a tag event and refuses a malformed tag', () => {
    const decoded = decodeChangeEvent(
      { id: 'x', timestamp: 1, action: 'add-tag', cardName: 'Sol Ring', cardId: 3, tag: ' Ramp ' },
      'Change #1 ',
    )
    expect(decoded).toMatchObject({ action: 'add-tag', tag: 'Ramp' })
    expect(
      decodeChangeEvent(
        { id: 'x', timestamp: 1, action: 'remove-tag', cardName: 'Sol Ring', tag: 'a,b' },
        'Change #1 ',
      ),
    ).toMatch(/^Change #1 Invalid tag/)
    expect(
      decodeChangeEvent({ id: 'x', timestamp: 1, action: 'add-tag', cardName: 'Sol Ring' }, 'C '),
    ).toBe('C (add-tag) is missing its "tag".')
  })

  test('decodeChangeEvent canonicalizes an add’s tags and refuses a bad set', () => {
    const decoded = decodeChangeEvent(
      { id: 'x', timestamp: 1, action: 'add', cardName: 'Sol Ring', tags: ['Zebra', ' apple'] },
      '',
    )
    expect(decoded).toMatchObject({ tags: ['apple', 'Zebra'] })
    expect(
      decodeChangeEvent(
        { id: 'x', timestamp: 1, action: 'add', cardName: 'Sol Ring', tags: 'a' },
        '',
      ),
    ).toBe('tags must be an array of tags.')
  })

  test('decodeChangeEvent folds an empty tag set to absent and refuses a non-string tag', () => {
    const empty = decodeChangeEvent(
      { id: 'x', timestamp: 1, action: 'add', cardName: 'Sol Ring', tags: [] },
      '',
    )
    expect(typeof empty === 'object' && 'tags' in empty).toBe(false)
    expect(
      decodeChangeEvent(
        { id: 'x', timestamp: 1, action: 'add-tag', cardName: 'Sol Ring', tag: 5 },
        'C ',
      ),
    ).toBe('C has an invalid "tag".')
    // Judged per field: a stray tag on an unrelated action is validated, not kept verbatim.
    expect(
      decodeChangeEvent(
        {
          id: 'x',
          timestamp: 1,
          action: 'set-note',
          cardName: 'Sol Ring',
          note: 'n',
          tag: 'no&way',
        },
        'C ',
      ),
    ).toMatch(/^C Invalid tag/)
  })

  test('encode writes the tag fields in the declared key order', () => {
    expect(encodeChangeEvent(createAddTagChange('Sol Ring', { tag: 'ramp', cardId: 3 }))).toBe(
      '{"action":"add-tag","cardName":"Sol Ring","cardId":3,"tag":"ramp"}',
    )
    expect(
      encodeChangeEvent(
        createAddChange('Sol Ring', { cardId: 3, labels: ['proxy'], tags: ['ramp'] }),
      ),
    ).toBe('{"action":"add","cardName":"Sol Ring","cardId":3,"labels":["proxy"],"tags":["ramp"]}')
  })

  test('history compaction annihilates an add-tag against a later remove-tag', () => {
    const older = changeSetFromEvents('2026-01-01T00:00:00.000Z', [
      createAddTagChange('Sol Ring', { tag: 'ramp', cardId: 3 }),
      createAddTagChange('Sol Ring', { tag: 'staple', cardId: 3 }),
    ])
    const newer = changeSetFromEvents('2026-01-02T00:00:00.000Z', [
      createRemoveTagChange('Sol Ring', { tag: 'ramp', cardId: 3 }),
    ])
    const merged = combineSetsInto([older, newer], 1, 0)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.events.map((e) => ('tag' in e ? `${e.action}:${e.tag}` : e.action))).toEqual([
      'add-tag:staple',
    ])
  })
})

describe('apply engines', () => {
  it('collection: add-tag / remove-tag edit the target’s canonical tag set', () => {
    const tagged = applyChangeToCollection([makeEntry({ tags: ['zebra'] })], {
      action: 'add-tag',
      cardName: 'Lightning Bolt',
      cardId: 1,
      tag: ' apple ',
    })
    expect(tagged[0]!.tags).toEqual(['apple', 'zebra'])
    const untagged = applyChangeToCollection(tagged, {
      action: 'remove-tag',
      cardName: 'Lightning Bolt',
      cardId: 1,
      tag: 'zebra',
    })
    expect(untagged[0]!.tags).toEqual(['apple'])
    const bare = applyChangeToCollection(untagged, {
      action: 'remove-tag',
      cardName: 'Lightning Bolt',
      cardId: 1,
      tag: 'apple',
    })
    expect(bare[0]!.tags).toBeUndefined()
  })

  it('collection: add carries a canonical tag set onto the new entry; a missing target misses', () => {
    const added = applyChangeToCollection([], {
      action: 'add',
      cardName: 'Sol Ring',
      set: 'c21',
      collectorNumber: '263',
      tags: ['ramp', ' ramp'],
    })
    expect(added[0]!.tags).toEqual(['ramp'])
    let miss: string | undefined
    applyChangeToCollection(
      [makeEntry()],
      { action: 'add-tag', cardName: 'Black Lotus', tag: 'ramp' },
      { onMiss: (reason) => (miss = reason) },
    )
    expect(miss).toBe('no-target')
  })

  it('wanted: tags apply on every list type', () => {
    const entries: WantedListCardEntry[] = [
      { name: 'Sol Ring', price: 0, fileOrder: 0, section: 'Main', state: 'name-only', cardId: 1 },
    ]
    const tagged = applyChangeToWantedList(entries, {
      action: 'add-tag',
      cardName: 'Sol Ring',
      cardId: 1,
      tag: 'upgrade',
    })
    expect(tagged[0]!.tags).toEqual(['upgrade'])
    const untagged = applyChangeToWantedList(tagged, {
      action: 'remove-tag',
      cardName: 'Sol Ring',
      cardId: 1,
      tag: 'upgrade',
    })
    expect(untagged[0]!.tags).toBeUndefined()
    const added = applyChangeToWantedList([], {
      action: 'add',
      cardName: 'Arcane Signet',
      tags: ['ramp'],
    })
    expect(added[0]!.tags).toEqual(['ramp'])
  })

  const deck = (): DeckData => ({
    name: 'D',
    format: 'commander',
    sections: [
      {
        name: 'Main',
        cards: [{ quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
      },
    ],
  })

  it('deck: add-tag / remove-tag edit the line', () => {
    const tagged = applyChangeToDeck(deck(), {
      action: 'add-tag',
      cardName: 'Sol Ring',
      cardId: 1,
      tag: 'ramp',
    })
    expect(tagged.sections[0]!.cards[0]!.tags).toEqual(['ramp'])
    const untagged = applyChangeToDeck(tagged, {
      action: 'remove-tag',
      cardName: 'Sol Ring',
      cardId: 1,
      tag: 'ramp',
    })
    expect(untagged.sections[0]!.cards[0]!.tags).toBeUndefined()
  })

  it('deck and collection: a move-to lands the copy with its tags', () => {
    const arrived = applyChangeToDeck(deck(), {
      action: 'move-to',
      cardName: 'Sol Ring',
      set: 'c21',
      collectorNumber: '263',
      tags: ['ramp'],
      from: { type: 'collection', name: 'Binder' },
    })
    expect(arrived.sections[0]!.cards.map((c) => [c.quantity, c.tags])).toEqual([
      [2, undefined],
      [1, ['ramp']],
    ])
    const entries = applyChangeToCollection([], {
      action: 'move-to',
      cardName: 'Sol Ring',
      set: 'c21',
      collectorNumber: '263',
      tags: ['Card Draw', 'ramp'],
      from: { type: 'deck', name: 'Test Deck' },
    })
    expect(entries[0]!.tags).toEqual(['Card Draw', 'ramp'])
  })

  it('deck: a differently-tagged add starts its own line instead of merging', () => {
    const merged = applyChangeToDeck(deck(), {
      action: 'add',
      cardName: 'Sol Ring',
      set: 'c21',
      collectorNumber: '263',
    })
    expect(merged.sections[0]!.cards).toHaveLength(1)
    expect(merged.sections[0]!.cards[0]!.quantity).toBe(3)
    const split = applyChangeToDeck(deck(), {
      action: 'add',
      cardName: 'Sol Ring',
      set: 'c21',
      collectorNumber: '263',
      tags: ['ramp'],
    })
    expect(split.sections[0]!.cards).toHaveLength(2)
    expect(split.sections[0]!.cards[1]!.tags).toEqual(['ramp'])
  })
})

describe('list snapshot', () => {
  test('emits one add-tag per tag after the card’s adds', () => {
    const events = buildDefaultChangeEvents({
      sectionOrder: ['Main'],
      entries: [
        {
          name: 'Sol Ring',
          quantity: 1,
          section: 'Main',
          isCommander: false,
          cardId: 4,
          tags: ['ramp', 'staple'],
        },
      ],
    })
    expect(events.map((e) => ('tag' in e ? `${e.action}:${e.tag}` : e.action))).toEqual([
      'add',
      'add-tag:ramp',
      'add-tag:staple',
    ])
  })
})

describe('line-preserving one-shot path', () => {
  const collection = ['# Binder', '', '- Sol Ring (C21:263) [foil] #ramp {shelf 2} &1', ''].join(
    '\n',
  )
  // The resolved target carries the line's own fields, as the one-shot commands
  // resolve it; the path adopts only the id, language, labels and tags itself.
  const solRing: EntryRef = {
    name: 'Sol Ring',
    set: 'c21',
    collectorNumber: '263',
    finish: 'foil',
    note: 'shelf 2',
    cardId: 1,
  }

  test('add-tag and remove-tag rewrite only the tag token, in canonical position', () => {
    const tagged = applyTargetedChangesToContent(collection, 'collection', solRing, [
      createAddTagChange('Sol Ring', { tag: 'Card Draw', cardId: 1 }),
    ])
    expect(tagged).toBe(
      ['# Binder', '', '- Sol Ring (C21:263) [foil] #Card Draw, ramp {shelf 2} &1', ''].join('\n'),
    )
    const untagged = applyTargetedChangesToContent(tagged, 'collection', solRing, [
      createRemoveTagChange('Sol Ring', { tag: 'ramp', cardId: 1 }),
      createRemoveTagChange('Sol Ring', { tag: 'Card Draw', cardId: 1 }),
    ])
    expect(untagged).toContain('- Sol Ring (C21:263) [foil] {shelf 2} &1')
  })

  test('an edit about another field keeps the line’s tags', () => {
    const noted = applyTargetedChangesToContent(collection, 'collection', solRing, [
      { id: 'n', timestamp: 0, action: 'set-note', cardName: 'Sol Ring', cardId: 1, note: 'moved' },
    ])
    expect(noted).toContain('- Sol Ring (C21:263) [foil] #ramp {moved} &1')
  })

  test('a deck decrement keeps the line’s tags, and a tagged add starts its own line', () => {
    const deckText = ['# Deck', '', '## Main', '- 3 Sol Ring (C21:263) #ramp &1', ''].join('\n')
    const deckRing: EntryRef = {
      name: 'Sol Ring',
      set: 'c21',
      collectorNumber: '263',
      quantity: 3,
      cardId: 1,
    }
    const decremented = applyTargetedChangesToContent(deckText, 'deck', deckRing, [
      createRemoveChange('Sol Ring', { cardId: 1 }),
    ])
    expect(decremented).toContain('- 2 Sol Ring (C21:263) #ramp &1')
    const { content: merged } = applyDeckAddToContent(
      deckText,
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', tags: ['ramp'] },
      1,
    )
    expect(merged).toContain('- 4 Sol Ring (C21:263) #ramp &1')
    const { content: split } = applyDeckAddToContent(
      deckText,
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', tags: ['staple'] },
      1,
    )
    expect(split).toContain('- 3 Sol Ring (C21:263) #ramp &1')
    expect(split).toContain('- 1 Sol Ring (C21:263) #staple &2')
  })
})
