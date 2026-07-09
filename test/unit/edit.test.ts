import { describe, expect, test } from 'bun:test'
import type { Choice } from 'prompts'
import {
  buildListSelectionChoices,
  type PendingChangesByFile,
  type UnifiedListRef,
  type UnifiedSelection,
} from '../../src/commands/edit'

const refs: UnifiedListRef[] = [
  { type: 'wanted', name: 'To Buy', file: '/wanted/to-buy.md' },
  { type: 'deck', name: 'Winota Stax', file: '/decks/winota-stax.md' },
  { type: 'collection', name: 'Main Binder', file: '/collections/Main Binder.md' },
]

const deck = (name: string): UnifiedListRef => ({
  type: 'deck',
  name,
  file: `/decks/${name}.md`,
})
const binder: UnifiedListRef = {
  type: 'collection',
  name: 'Main Binder',
  file: '/collections/Main Binder.md',
}

function selectionOf(choice: Choice): UnifiedSelection {
  return choice.value as UnifiedSelection
}

describe('buildListSelectionChoices', () => {
  test('groups lists by type in canonical order, with type icons', () => {
    const titles = buildListSelectionChoices(refs, new Map()).map((c) => c.title)
    expect(titles).toEqual([
      '🗃️ All Lists',
      '🎴 Winota Stax',
      '📦 Main Binder',
      '🎯 To Buy',
      '➕ New Deck',
      '➕ New Collection',
      '➕ New Wanted List',
      '🚪 Exit',
    ])
  })

  test('All Lists leads the menu once two lists of different types exist', () => {
    const one = buildListSelectionChoices(refs.slice(0, 1), new Map())
    expect(one.map(selectionOf)).not.toContainEqual({ kind: 'scope', scope: 'all' })

    const two = buildListSelectionChoices(refs.slice(0, 2), new Map())
    expect(selectionOf(two[0]!)).toEqual({ kind: 'scope', scope: 'all' })
  })

  test('a per-type scope appears once that type has two lists', () => {
    const oneDeck = buildListSelectionChoices([deck('A')], new Map())
    expect(oneDeck.map((c) => c.title)).not.toContain('🎴 All Decks')

    const titles = buildListSelectionChoices([deck('A'), deck('B'), binder], new Map()).map(
      (c) => c.title,
    )
    // Two decks and a collection: All Lists spans everything, All Decks the pair.
    expect(titles.slice(0, 2)).toEqual(['🗃️ All Lists', '🎴 All Decks'])
    expect(titles).not.toContain('📦 All Collections')
  })

  test('All Lists is hidden when every list shares one type', () => {
    // It would open exactly the same session as All Decks, so offering both is noise.
    const titles = buildListSelectionChoices([deck('A'), deck('B')], new Map()).map((c) => c.title)
    expect(titles).not.toContain('🗃️ All Lists')
    expect(titles[0]).toBe('🎴 All Decks')
  })

  test('every scope is offered, in canonical order, when each spans two lists', () => {
    const many: UnifiedListRef[] = [
      deck('A'),
      deck('B'),
      binder,
      { type: 'collection', name: 'Trades', file: '/collections/Trades.md' },
      { type: 'wanted', name: 'To Buy', file: '/wanted/to-buy.md' },
      { type: 'wanted', name: 'Later', file: '/wanted/later.md' },
    ]
    const titles = buildListSelectionChoices(many, new Map()).map((c) => c.title)
    expect(titles.slice(0, 4)).toEqual([
      '🗃️ All Lists',
      '🎴 All Decks',
      '📦 All Collections',
      '🎯 All Wanted Lists',
    ])
    expect(selectionOf(buildListSelectionChoices(many, new Map())[1]!)).toEqual({
      kind: 'scope',
      scope: 'deck',
    })
  })

  test('list choices carry an open selection with the full ref', () => {
    const deck = buildListSelectionChoices(refs, new Map())[1]!
    expect(selectionOf(deck)).toEqual({
      kind: 'open',
      list: { type: 'deck', name: 'Winota Stax', file: '/decks/winota-stax.md' },
    })
  })

  test('open lists with pending changes get an unsaved badge', () => {
    const pending: PendingChangesByFile = new Map([
      ['/decks/winota-stax.md', { changes: 2, isNew: false }],
      ['/wanted/to-buy.md', { changes: 0, isNew: false }],
    ])
    const titles = buildListSelectionChoices(refs, pending).map((c) => c.title)
    expect(titles).toContain('🎴 Winota Stax — 2 unsaved change(s)')
    // A zero count (opened but fully saved) renders without a badge.
    expect(titles).toContain('🎯 To Buy')
  })

  test('a list created this session is badged as new until it is saved', () => {
    const pending: PendingChangesByFile = new Map([
      ['/collections/Main Binder.md', { changes: 0, isNew: true }],
      ['/wanted/to-buy.md', { changes: 3, isNew: true }],
    ])
    const titles = buildListSelectionChoices(refs, pending).map((c) => c.title)
    // A brand-new list has no card changes yet, but its creation is itself unsaved.
    expect(titles).toContain('📦 Main Binder — new')
    expect(titles).toContain('🎯 To Buy — new, 3 unsaved change(s)')
  })

  test('create-new and exit selections are typed actions', () => {
    const choices = buildListSelectionChoices([], new Map())
    expect(choices.map((c) => selectionOf(c))).toEqual([
      { kind: 'new', type: 'deck' },
      { kind: 'new', type: 'collection' },
      { kind: 'new', type: 'wanted' },
      { kind: 'exit' },
    ])
  })
})
