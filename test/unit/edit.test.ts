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

function selectionOf(choice: Choice): UnifiedSelection {
  return choice.value as UnifiedSelection
}

describe('buildListSelectionChoices', () => {
  test('groups lists by type in canonical order, with type icons', () => {
    const titles = buildListSelectionChoices(refs, new Map()).map((c) => c.title)
    expect(titles).toEqual([
      '🎴 Winota Stax',
      '📦 Main Binder',
      '🎯 To Buy',
      '➕ New Deck',
      '➕ New Collection',
      '➕ New Wanted List',
      '🚪 Exit',
    ])
  })

  test('list choices carry an open selection with the full ref', () => {
    const first = buildListSelectionChoices(refs, new Map())[0]!
    expect(selectionOf(first)).toEqual({
      kind: 'open',
      list: { type: 'deck', name: 'Winota Stax', file: '/decks/winota-stax.md' },
    })
  })

  test('open lists with pending changes get an unsaved badge', () => {
    const pending: PendingChangesByFile = new Map([
      ['/decks/winota-stax.md', 2],
      ['/wanted/to-buy.md', 0],
    ])
    const titles = buildListSelectionChoices(refs, pending).map((c) => c.title)
    expect(titles).toContain('🎴 Winota Stax — 2 unsaved change(s)')
    // A zero count (opened but fully saved) renders without a badge.
    expect(titles).toContain('🎯 To Buy')
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
