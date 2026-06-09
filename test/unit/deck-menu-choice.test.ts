import { describe, expect, test } from 'bun:test'
import type { Choice } from 'prompts'
import { isMenuChoice } from '../../src/commands/deck'

describe('isMenuChoice', () => {
  test('recognizes menu sentinel values', () => {
    for (const value of ['__DONE__', '__EXIT__', '__SECTION__', '__ADD_ANOTHER__']) {
      expect(isMenuChoice({ title: value, value })).toBe(true)
    }
  })

  test('does not treat underscore-prefixed card names as menu items', () => {
    // Real MTG card names can begin with underscores (e.g. the Unstable card
    // `_____ Goblin`); a prefix check on `__` would wrongly leak them into the
    // pre-typing menu. Exact sentinel membership must reject them.
    const goblin: Choice = { title: '_____ Goblin', value: '_____ Goblin' }
    expect(isMenuChoice(goblin)).toBe(false)
    expect(isMenuChoice({ title: '__Wug__', value: '__Wug__' })).toBe(false)
  })

  test('rejects collector-mode object choices', () => {
    const choice: Choice = { title: '1 - Sol Ring', value: { type: 'card', num: '1' } }
    expect(isMenuChoice(choice)).toBe(false)
  })
})
