import { describe, expect, test } from 'bun:test'
import { matchesTags } from '../../../src/site/card-tags'

// The three match modes are pinned against `matchesSelection` in filter-mode.test.ts;
// `matchesTags` only adds that a card's own tag list is what gets matched.
describe('matchesTags', () => {
  const tags = ['mana-rock', 'ramp', 'artifact']

  test("matches the card's tag list under the given mode", () => {
    expect(matchesTags(tags, ['ramp'], 'include')).toBe(true)
    expect(matchesTags(tags, ['flying'], 'include')).toBe(false)
    expect(matchesTags(tags, ['ramp', 'artifact'], 'exact')).toBe(true)
    expect(matchesTags(tags, ['flying'], 'exclude')).toBe(true)
  })
})
