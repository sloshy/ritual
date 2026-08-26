import { describe, expect, test } from 'bun:test'
import {
  enabledScopeRefs,
  refsOfType,
  toggleListExclusion,
  toggleTypeExclusion,
  typeScopeState,
} from '../../src/list-view/find-scope'
import { listRefKey, type ListRefKey } from '../../src/list-view/combined-list'
import type { CombinedListRef, NamedListRef } from '../../src/list-view/combined-list'

const REFS: NamedListRef[] = [
  { type: 'deck', slug: 'burn', name: 'Burn' },
  { type: 'deck', slug: 'mill', name: 'Mill' },
  { type: 'collection', slug: 'binder', name: 'Binder' },
  { type: 'wanted', slug: 'wish', name: 'Wish' },
]

const excludedSet = (...keys: ListRefKey[]): Set<ListRefKey> => new Set(keys)

describe('refsOfType', () => {
  test('keeps only refs of the given type, in order', () => {
    expect(refsOfType(REFS, 'deck').map((r) => r.slug)).toEqual(['burn', 'mill'])
    expect(refsOfType(REFS, 'wanted').map((r) => r.slug)).toEqual(['wish'])
  })

  test('is empty for a type with no lists', () => {
    expect(refsOfType(REFS.slice(0, 3), 'wanted')).toEqual([])
  })
})

describe('enabledScopeRefs', () => {
  test('returns every ref when nothing is excluded', () => {
    expect(enabledScopeRefs(excludedSet(), REFS)).toEqual(REFS)
  })

  test('drops excluded refs while preserving order', () => {
    const excluded = excludedSet('deck:burn', 'wanted:wish')
    expect(enabledScopeRefs(excluded, REFS).map(listRefKey)).toEqual([
      'deck:mill',
      'collection:binder',
    ])
  })
})

describe('typeScopeState', () => {
  test('is "all" when no list of the type is excluded', () => {
    expect(typeScopeState(excludedSet(), REFS, 'deck')).toBe('all')
  })

  test('is "partial" when only some lists of the type are excluded', () => {
    expect(typeScopeState(excludedSet('deck:burn'), REFS, 'deck')).toBe('partial')
  })

  test('is "none" when every list of the type is excluded', () => {
    expect(typeScopeState(excludedSet('deck:burn', 'deck:mill'), REFS, 'deck')).toBe('none')
  })

  test('exclusions of other types do not affect a type', () => {
    expect(typeScopeState(excludedSet('collection:binder'), REFS, 'deck')).toBe('all')
  })

  test('is "all" for a type with no lists', () => {
    expect(typeScopeState(excludedSet(), [], 'deck')).toBe('all')
  })
})

describe('toggleTypeExclusion', () => {
  test('excludes every list of a fully-enabled type', () => {
    const next = toggleTypeExclusion(excludedSet(), REFS, 'deck')
    expect([...next].sort()).toEqual(['deck:burn', 'deck:mill'])
  })

  test('re-includes every list of a partially-excluded type', () => {
    const next = toggleTypeExclusion(excludedSet('deck:burn'), REFS, 'deck')
    expect(next.size).toBe(0)
  })

  test('re-includes every list of a fully-excluded type, leaving other types alone', () => {
    const next = toggleTypeExclusion(
      excludedSet('deck:burn', 'deck:mill', 'wanted:wish'),
      REFS,
      'deck',
    )
    expect([...next]).toEqual(['wanted:wish'])
  })

  test('is a no-op for a type with no lists', () => {
    const next = toggleTypeExclusion(excludedSet('deck:burn'), [], 'deck')
    expect([...next]).toEqual(['deck:burn'])
  })

  test('returns a new set without mutating the input', () => {
    const input = excludedSet()
    const next = toggleTypeExclusion(input, REFS, 'deck')
    expect(input.size).toBe(0)
    expect(next).not.toBe(input)
  })
})

describe('toggleListExclusion', () => {
  test('excludes an enabled list and re-includes an excluded one', () => {
    const ref: CombinedListRef = { type: 'collection', slug: 'binder' }
    const off = toggleListExclusion(excludedSet(), ref)
    expect([...off]).toEqual(['collection:binder'])
    const on = toggleListExclusion(off, ref)
    expect(on.size).toBe(0)
  })

  // Load-bearing for Solid: the setter relies on a *new* Set — returning the
  // mutated original would make the signal's `===` check skip the update.
  test('returns a new set without mutating the input', () => {
    const input = excludedSet()
    const off = toggleListExclusion(input, { type: 'collection', slug: 'binder' })
    expect(input.size).toBe(0)
    expect(off).not.toBe(input)
  })
})
