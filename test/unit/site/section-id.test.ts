import { describe, expect, test } from 'bun:test'
import { sectionId } from '../../../src/site/section-id'

describe('sectionId', () => {
  test('keeps ASCII letters, digits and hyphens, and escapes everything else', () => {
    expect(sectionId('color:WU')).toBe('section-color_3a_WU')
    expect(sectionId('type:creature')).toBe('section-type_3a_creature')
  })

  test.each<[string, string, string]>([
    // Same length, different non-ASCII script: a lossy `[^a-z0-9] → _` gave both `category____`.
    ['non-ASCII', 'category:ドロー', 'category:ランプ'],
    // Punctuation against the character it used to collapse into.
    ['punctuation', 'tags:ramp, staple', 'tags:ramp_ staple'],
    // An escape's own spelling, written out literally.
    ['an escape spelled out', 'tags:a_20_b', 'tags:a b'],
    ['same-length ASCII', 'tags:a.b', 'tags:a,b'],
  ])('two keys never share an id (%s)', (_label, left, right) => {
    expect(sectionId(left)).not.toBe(sectionId(right))
  })

  test('an id is safe in an href fragment and in getElementById', () => {
    expect(sectionId('category:ドロー')).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
