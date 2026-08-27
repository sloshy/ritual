import { describe, test, expect } from 'bun:test'
import {
  buildEntryIndex,
  entryAtModalKey,
  findEntryIndex,
} from '../../../src/list-view/entry-index'

const entries = [
  { name: 'Sol Ring', set: 'lea', fileOrder: 0 },
  { name: 'Sol Ring', set: 'mkm', fileOrder: 1 },
  { name: 'Black Lotus', fileOrder: 2 },
]

describe('entry index', () => {
  test('finds the entry a card tile came from', () => {
    const index = buildEntryIndex(entries)
    expect(findEntryIndex(index, { name: 'Sol Ring', setCode: 'mkm', fileOrder: 1 })).toBe(1)
  })

  test('a name-only entry keys on the empty set code', () => {
    const index = buildEntryIndex(entries)
    expect(findEntryIndex(index, { name: 'Black Lotus', fileOrder: 2 })).toBe(2)
    expect(findEntryIndex(index, { name: 'Black Lotus', setCode: '', fileOrder: 2 })).toBe(2)
  })

  test('set codes are compared case-insensitively on both sides', () => {
    const index = buildEntryIndex([{ name: 'Sol Ring', set: 'LEA', fileOrder: 0 }])
    expect(findEntryIndex(index, { name: 'Sol Ring', setCode: 'lea', fileOrder: 0 })).toBe(0)
  })

  test('and reciprocally — a lowercase entry matches an uppercase tile', () => {
    const index = buildEntryIndex([{ name: 'Sol Ring', set: 'lea', fileOrder: 0 }])
    expect(findEntryIndex(index, { name: 'Sol Ring', setCode: 'LEA', fileOrder: 0 })).toBe(0)
  })

  test('a card with no matching entry reports -1 rather than a stale position', () => {
    const index = buildEntryIndex(entries)
    expect(findEntryIndex(index, { name: 'Sol Ring', setCode: 'lea', fileOrder: 9 })).toBe(-1)
    expect(findEntryIndex(index, { name: 'Mox Pearl', setCode: 'lea', fileOrder: 0 })).toBe(-1)
  })

  test('file order separates two copies of the same printing', () => {
    const index = buildEntryIndex([
      { name: 'Sol Ring', set: 'lea', fileOrder: 4 },
      { name: 'Sol Ring', set: 'lea', fileOrder: 5 },
    ])
    expect(findEntryIndex(index, { name: 'Sol Ring', setCode: 'lea', fileOrder: 5 })).toBe(1)
  })
})

describe('entryAtModalKey', () => {
  const list = ['a', 'b', 'c']

  test('the key is the entry position in the page list', () => {
    expect(entryAtModalKey(list, '1')).toBe('b')
  })

  test('a closed modal names no entry', () => {
    expect(entryAtModalKey(list, null)).toBeUndefined()
  })

  test('a key that is not a position at all answers undefined, not the wrong line', () => {
    expect(entryAtModalKey(list, 'abc')).toBeUndefined()
    expect(entryAtModalKey(list, '')).toBeUndefined()
  })

  test('a position that is no longer there answers undefined', () => {
    expect(entryAtModalKey(list, '9')).toBeUndefined()
    expect(entryAtModalKey([], '0')).toBeUndefined()
  })
})
