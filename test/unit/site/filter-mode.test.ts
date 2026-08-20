import { describe, expect, test } from 'bun:test'
import {
  FILTER_MATCH_MODES,
  LIST_SHARE_MATCHES,
  LIST_SHARE_MODES,
  matchesSelection,
} from '../../../src/site/filter-mode'

// These values are URL tokens (`sharedMode=` / `sharedMatch=` params), so a
// rename breaks shared links — pinned exactly. The order only fixes the
// toggle-button order in the UI.
describe('share filter vocabularies', () => {
  test('LIST_SHARE_MODES is exactly any/all, in order', () => {
    expect(LIST_SHARE_MODES).toEqual(['any', 'all'])
  })

  test('LIST_SHARE_MATCHES is exactly name/printing, in order', () => {
    expect(LIST_SHARE_MATCHES).toEqual(['name', 'printing'])
  })
})

describe('matchesSelection', () => {
  const values = new Set(['mana-rock', 'ramp', 'artifact'])

  test('an empty selection matches everything (the filter is inactive)', () => {
    for (const mode of FILTER_MATCH_MODES) {
      expect(matchesSelection(values, [], mode)).toBe(true)
      expect(matchesSelection(new Set(), [], mode)).toBe(true)
    }
  })

  test("'include' matches when at least one selected value is present", () => {
    expect(matchesSelection(values, ['ramp', 'flying'], 'include')).toBe(true)
    expect(matchesSelection(values, ['flying'], 'include')).toBe(false)
  })

  test("'exact' matches only when every selected value is present", () => {
    expect(matchesSelection(values, ['ramp', 'artifact'], 'exact')).toBe(true)
    expect(matchesSelection(values, ['ramp', 'flying'], 'exact')).toBe(false)
  })

  test("'exact' ignores values the card has beyond the selection", () => {
    expect(matchesSelection(values, ['ramp'], 'exact')).toBe(true)
  })

  test("'exclude' matches only when no selected value is present", () => {
    expect(matchesSelection(values, ['flying', 'lifelink'], 'exclude')).toBe(true)
    expect(matchesSelection(values, ['ramp', 'flying'], 'exclude')).toBe(false)
  })

  test('a card with no values fails include/exact but passes exclude', () => {
    const empty = new Set<string>()
    expect(matchesSelection(empty, ['ramp'], 'include')).toBe(false)
    expect(matchesSelection(empty, ['ramp'], 'exact')).toBe(false)
    expect(matchesSelection(empty, ['ramp'], 'exclude')).toBe(true)
  })
})
