import { describe, expect, it, test } from 'bun:test'
import {
  consolidateSetLabel,
  createSetLabelChange,
  formatChangeCore,
  isAdditiveChange,
  type ChangeEvent,
} from '../../src/change-event'
import { applyChangeToCollection } from '../../src/editor/collection-changes'
import { applyChangeToWantedList } from '../../src/editor/wanted-changes'
import { applyChangeToDeck } from '../../src/editor/deck-changes'
import { parseChangeLine } from '../../src/changelog-parser'
import type { CollectionCardEntry, WantedListCardEntry } from '../../src/site/data-types'
import type { DeckData } from '../../src/types'

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
    cardId: 1,
    ...overrides,
  }
}

describe('applyChangeToCollection — set-label', () => {
  it('sets a normalized override on the target entry', () => {
    const result = applyChangeToCollection([makeEntry()], {
      action: 'set-label',
      cardName: 'Lightning Bolt',
      cardId: 1,
      labels: ['trade', 'sale'],
    })
    expect(result[0]!.labels).toEqual(['sale', 'trade'])
  })

  it('an empty label set clears the override', () => {
    const result = applyChangeToCollection([makeEntry({ labels: ['keep'] })], {
      action: 'set-label',
      cardName: 'Lightning Bolt',
      cardId: 1,
      labels: [],
    })
    expect(result[0]!.labels).toBeUndefined()
  })

  it('a missing target reports no-target and leaves entries unchanged', () => {
    const entries = [makeEntry()]
    let miss: string | undefined
    const result = applyChangeToCollection(
      entries,
      { action: 'set-label', cardName: 'Black Lotus', labels: ['keep'] },
      { onMiss: (reason) => (miss = reason) },
    )
    expect(result).toBe(entries)
    expect(miss).toBe('no-target')
  })

  it('add carries a normalized label override onto the new entry', () => {
    const result = applyChangeToCollection([], {
      action: 'add',
      cardName: 'Sol Ring',
      set: 'c21',
      collectorNumber: '263',
      labels: ['trade', 'sale'],
    })
    expect(result[0]!.labels).toEqual(['sale', 'trade'])
  })
})

describe('set-label on other list types', () => {
  it('wanted lists report not-applicable', () => {
    const entries: WantedListCardEntry[] = []
    let miss: string | undefined
    applyChangeToWantedList(
      entries,
      { action: 'set-label', cardName: 'Sol Ring', labels: ['sale'] },
      { onMiss: (reason) => (miss = reason) },
    )
    expect(miss).toBe('not-applicable')
  })

  it('decks report not-applicable', () => {
    const deck: DeckData = { name: 'Test', sections: [{ name: 'Main', cards: [] }] }
    let miss: string | undefined
    applyChangeToDeck(
      deck,
      { action: 'set-label', cardName: 'Sol Ring', labels: ['sale'] },
      { onMiss: (reason) => (miss = reason) },
    )
    expect(miss).toBe('not-applicable')
  })
})

describe('consolidateSetLabel', () => {
  it('latest wins — replaces an earlier set-label for the same card', () => {
    const first = createSetLabelChange('Sol Ring', { labels: ['sale'], cardId: 2 })
    const changes: ChangeEvent[] = [first]
    const result = consolidateSetLabel(changes, 'Sol Ring', ['keep'], undefined, 2)
    expect(result.cancelledChange).toBe(first)
    expect(result.addedChange).toMatchObject({ action: 'set-label', labels: ['keep'] })
    expect(result.changes).toHaveLength(1)
  })

  it('restoring the original override is a no-op that drops the pending change', () => {
    const first = createSetLabelChange('Sol Ring', { labels: ['keep'], cardId: 2 })
    const result = consolidateSetLabel([first], 'Sol Ring', ['sale', 'trade'], ['trade', 'sale'], 2)
    expect(result.addedChange).toBeNull()
    expect(result.cancelledChange).toBe(first)
    expect(result.changes).toHaveLength(0)
  })

  it('label order does not defeat the equality check', () => {
    const result = consolidateSetLabel([], 'Sol Ring', ['trade', 'sale'], ['sale', 'trade'], 2)
    expect(result.addedChange).toBeNull()
    expect(result.changes).toHaveLength(0)
  })
})

describe('formatChangeCore — set-label wording', () => {
  test('set, past tense, quoted (the persisted changelog form)', () => {
    const change = createSetLabelChange('Sol Ring', { labels: ['trade', 'sale'], cardId: 5 })
    expect(formatChangeCore(change, { tense: 'past', quoteCardName: true })).toBe(
      'Set labels on "Sol Ring" &5 to [sale,trade]',
    )
  })

  test('clear, both tenses', () => {
    const change = createSetLabelChange('Sol Ring', { labels: [], cardId: 5 })
    expect(formatChangeCore(change, { tense: 'past' })).toBe('Cleared labels on Sol Ring &5')
    expect(formatChangeCore(change, { tense: 'present' })).toBe('Clear labels on Sol Ring &5')
  })

  test('set-label is classified additive', () => {
    expect(isAdditiveChange('set-label')).toBe(true)
  })
})

describe('parseChangeLine — label lines', () => {
  test('parses a Set labels line, quoted and with an id', () => {
    const parsed = parseChangeLine('- Set labels on "Sol Ring" &5 to [sale,trade]')
    expect(parsed).toEqual({
      action: 'Set labels',
      cardName: 'Sol Ring',
      labels: ['sale', 'trade'],
    })
  })

  test('parses a legacy unquoted card name', () => {
    const parsed = parseChangeLine('- Set labels on Sol Ring to [keep]')
    expect(parsed).toEqual({ action: 'Set labels', cardName: 'Sol Ring', labels: ['keep'] })
  })

  test('parses a Cleared labels line', () => {
    const parsed = parseChangeLine('- Cleared labels on "Sol Ring" &5')
    expect(parsed).toEqual({ action: 'Cleared labels', cardName: 'Sol Ring' })
  })

  test('does not swallow note or printing lines', () => {
    expect(parseChangeLine('- Set note on "Sol Ring" &5 to "labels on [sale]"')).toMatchObject({
      action: 'Set note',
      note: 'labels on [sale]',
    })
    expect(parseChangeLine('- Set "Sol Ring" printing to C21:263 [foil] &5')).toMatchObject({
      action: 'Set printing',
      set: 'c21',
    })
  })
})
