import { describe, expect, test } from 'bun:test'
import type { Choice } from 'prompts'
import {
  buildListSelectionChoices,
  parseDirectListArgument,
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
  test('groups lists by type in canonical order', () => {
    const choices = buildListSelectionChoices(refs, new Map())
    expect(choices.map(selectionOf)).toEqual([
      { kind: 'scope', scope: 'all' },
      { kind: 'open', list: refs[1]! },
      { kind: 'open', list: refs[2]! },
      { kind: 'open', list: refs[0]! },
      { kind: 'new', type: 'deck' },
      { kind: 'new', type: 'collection' },
      { kind: 'new', type: 'wanted' },
      { kind: 'exit' },
    ])
    // Open-list rows are labelled with their list's name.
    expect(choices[1]!.title).toContain('Winota Stax')
  })

  test('All Lists leads the menu once two lists of different types exist', () => {
    const one = buildListSelectionChoices(refs.slice(0, 1), new Map())
    expect(one.map(selectionOf)).not.toContainEqual({ kind: 'scope', scope: 'all' })

    const two = buildListSelectionChoices(refs.slice(0, 2), new Map())
    expect(selectionOf(two[0]!)).toEqual({ kind: 'scope', scope: 'all' })
  })

  test('a per-type scope appears once that type has two lists', () => {
    const oneDeck = buildListSelectionChoices([deck('A')], new Map())
    expect(oneDeck.map(selectionOf)).not.toContainEqual({ kind: 'scope', scope: 'deck' })

    const selections = buildListSelectionChoices([deck('A'), deck('B'), binder], new Map()).map(
      selectionOf,
    )
    // Two decks and a collection: All Lists spans everything, All Decks the pair.
    expect(selections.slice(0, 2)).toEqual([
      { kind: 'scope', scope: 'all' },
      { kind: 'scope', scope: 'deck' },
    ])
    expect(selections).not.toContainEqual({ kind: 'scope', scope: 'collection' })
  })

  test('All Lists is hidden when every list shares one type', () => {
    // It would open exactly the same session as All Decks, so offering both is noise.
    const selections = buildListSelectionChoices([deck('A'), deck('B')], new Map()).map(selectionOf)
    expect(selections).not.toContainEqual({ kind: 'scope', scope: 'all' })
    expect(selections[0]).toEqual({ kind: 'scope', scope: 'deck' })
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
    const selections = buildListSelectionChoices(many, new Map()).map(selectionOf)
    expect(selections.slice(0, 4)).toEqual([
      { kind: 'scope', scope: 'all' },
      { kind: 'scope', scope: 'deck' },
      { kind: 'scope', scope: 'collection' },
      { kind: 'scope', scope: 'wanted' },
    ])
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
    expect(titles.find((t) => t.includes('Winota Stax'))).toContain('— 2 unsaved change(s)')
    // A zero count (opened but fully saved) renders without a badge.
    expect(titles.find((t) => t.includes('To Buy'))).not.toContain('—')
  })

  test('a list created this session is badged as new until it is saved', () => {
    const pending: PendingChangesByFile = new Map([
      ['/collections/Main Binder.md', { changes: 0, isNew: true }],
      ['/wanted/to-buy.md', { changes: 3, isNew: true }],
    ])
    const titles = buildListSelectionChoices(refs, pending).map((c) => c.title)
    // A brand-new list has no card changes yet, but its creation is itself unsaved.
    expect(titles.find((t) => t.includes('Main Binder'))).toContain('— new')
    expect(titles.find((t) => t.includes('To Buy'))).toContain('— new, 3 unsaved change(s)')
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

describe('parseDirectListArgument', () => {
  test('a bare name with no flag type resolves across all types', () => {
    expect(parseDirectListArgument('Burn', undefined)).toEqual({ name: 'Burn', type: undefined })
  })

  test('a resolved type flag narrows the search', () => {
    expect(parseDirectListArgument('Burn', 'deck')).toEqual({ name: 'Burn', type: 'deck' })
    expect(parseDirectListArgument('Binder', 'collection')).toEqual({
      name: 'Binder',
      type: 'collection',
    })
  })

  test('a list-type prefix on the name overrides the type flag', () => {
    expect(parseDirectListArgument('collection:Binder', 'deck')).toEqual({
      name: 'Binder',
      type: 'collection',
    })
    expect(parseDirectListArgument('wanted:To Buy', undefined)).toEqual({
      name: 'To Buy',
      type: 'wanted',
    })
  })

  test('an unknown prefix is kept as part of the literal name', () => {
    expect(parseDirectListArgument('misc:Notes', undefined)).toEqual({
      name: 'misc:Notes',
      type: undefined,
    })
  })
})
