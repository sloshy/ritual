import { describe, expect, test } from 'bun:test'
import { matchesTags } from '../../../src/site/card-tags'

describe('matchesTags', () => {
  const tags = ['mana-rock', 'ramp', 'artifact']

  test('an empty selection matches everything (filter inactive)', () => {
    expect(matchesTags(tags, [], 'or')).toBe(true)
    expect(matchesTags([], [], 'and')).toBe(true)
  })

  test("'or' matches when at least one selected tag is present", () => {
    expect(matchesTags(tags, ['ramp', 'flying'], 'or')).toBe(true)
    expect(matchesTags(tags, ['flying'], 'or')).toBe(false)
  })

  test("'and' matches only when every selected tag is present", () => {
    expect(matchesTags(tags, ['ramp', 'artifact'], 'and')).toBe(true)
    expect(matchesTags(tags, ['ramp', 'flying'], 'and')).toBe(false)
  })

  test('a card with no tags fails any non-empty selection', () => {
    expect(matchesTags([], ['ramp'], 'or')).toBe(false)
    expect(matchesTags([], ['ramp'], 'and')).toBe(false)
  })
})
