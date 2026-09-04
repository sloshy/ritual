import { describe, expect, test } from 'bun:test'
import {
  cardTagsDelta,
  formatCardTags,
  formatCardTagsToken,
  invalidCardTagMessage,
  isCardTagShaped,
  normalizeCardTags,
  normalizedTags,
  parseCardTag,
  parseCardTagsInput,
  parseCardTagsValue,
  sameCardTags,
  withCardTag,
  withCardTags,
  withoutCardTag,
} from '../../src/card/card-tags'

/**
 * The tag vocabulary module: the shape rule every surface validates against,
 * the canonical form every writer emits, and the set algebra the editors turn
 * a "set the tags to …" gesture into.
 */

describe('isCardTagShaped', () => {
  test('accepts plain text in any case, with spaces and most punctuation', () => {
    for (const tag of [
      'ramp',
      'Ramp',
      'Card Draw',
      'Binder: Trade',
      'binder/trade',
      'edh-staple',
      'tier_1',
      '5',
      '2024 binder',
      "Rhystic's picks",
      'été',
      '日本語',
    ]) {
      expect(isCardTagShaped(tag)).toBe(true)
    }
  })

  test("refuses the card line's own punctuation, control characters and the empty string", () => {
    for (const raw of [
      '',
      '   ',
      '#ramp',
      'a,b',
      'a&b',
      'Alt *F*',
      'Say "hi"',
      '[keep]',
      '{note}',
      '(C21:263)',
      'a\tb',
    ]) {
      expect(isCardTagShaped(raw)).toBe(false)
    }
  })
})

describe('parseCardTag', () => {
  test('trims, folds inner whitespace, keeps case, and tolerates a leading #', () => {
    expect(parseCardTag('Ramp')).toEqual({ ok: true, tag: 'Ramp' })
    expect(parseCardTag('#ramp')).toEqual({ ok: true, tag: 'ramp' })
    expect(parseCardTag('  Card   Draw  ')).toEqual({ ok: true, tag: 'Card Draw' })
  })

  test('refuses a malformed tag with prose that names the offender', () => {
    const result = parseCardTag('a,b')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe(invalidCardTagMessage('a,b'))
    // The sentence itself, pinned once: it names the raw input and the shared
    // shape clause every other surface interpolates.
    expect(invalidCardTagMessage('a,b')).toBe(
      `Invalid tag "a,b": a tag is non-empty plain text that cannot contain '#', ',', '&', '*', double quotes, brackets, braces or parentheses.`,
    )
    expect(parseCardTag('').ok).toBe(false)
    expect(parseCardTag('#').ok).toBe(false)
    expect(parseCardTag('R&D').ok).toBe(false)
  })
})

describe('normalizeCardTags / normalizedTags', () => {
  test('deduplicates exactly (case is part of the tag) and sorts', () => {
    expect(normalizeCardTags(['Zebra', 'apple', ' apple ', 'Apple', 'Card  Draw'])).toEqual([
      'apple',
      'Apple',
      'Card Draw',
      'Zebra',
    ])
  })

  test('the stored form of an empty set is undefined, like a label override', () => {
    expect(normalizedTags(undefined)).toBeUndefined()
    expect(normalizedTags([])).toBeUndefined()
    expect(normalizedTags(['b', 'a'])).toEqual(['a', 'b'])
  })
})

describe('parseCardTagsValue', () => {
  test('accepts an array of tag-shaped strings and canonicalizes it', () => {
    expect(parseCardTagsValue(['#Ramp', 'staple', 'Ramp'], 'tags')).toEqual({
      ok: true,
      tags: ['Ramp', 'staple'],
    })
    expect(parseCardTagsValue([], 'tags')).toEqual({ ok: true, tags: [] })
  })

  test('refuses a non-array, a non-string element, and a malformed tag', () => {
    expect(parseCardTagsValue('ramp', 'tags')).toEqual({
      ok: false,
      message: 'tags must be an array of tags.',
    })
    expect(parseCardTagsValue([1], 'tags').ok).toBe(false)
    expect(parseCardTagsValue(['ramp', 'a&b'], 'tags').ok).toBe(false)
  })
})

describe('parseCardTagsInput', () => {
  test('splits on commas only — a space is part of a tag', () => {
    expect(parseCardTagsInput('My Tag,My Other Tag')).toEqual({
      ok: true,
      tags: ['My Other Tag', 'My Tag'],
    })
    expect(parseCardTagsInput('ramp staple')).toEqual({ ok: true, tags: ['ramp staple'] })
    expect(parseCardTagsInput('#ramp, Staple ,ramp')).toEqual({
      ok: true,
      tags: ['ramp', 'Staple'],
    })
  })

  test('an empty or blank input clears every tag', () => {
    expect(parseCardTagsInput('')).toEqual({ ok: true, tags: [] })
    expect(parseCardTagsInput('  , ')).toEqual({ ok: true, tags: [] })
  })

  test('one malformed entry refuses the whole input', () => {
    expect(parseCardTagsInput('ramp, R&D').ok).toBe(false)
  })
})

describe('formatCardTags / formatCardTagsToken / sameCardTags', () => {
  test('writes the comma-separated form in canonical order, and the file token once-sigilled', () => {
    expect(formatCardTags(['staple', 'Card Draw'])).toBe('Card Draw, staple')
    expect(formatCardTagsToken(['staple', 'Card Draw'])).toBe('#Card Draw, staple')
    expect(formatCardTags(undefined)).toBe('')
    expect(formatCardTags([])).toBe('')
    expect(formatCardTagsToken(undefined)).toBe('')
  })

  test('equality is order-insensitive and case-sensitive, with absent equal to empty', () => {
    expect(sameCardTags(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(sameCardTags(['Ramp'], ['ramp'])).toBe(false)
    expect(sameCardTags(undefined, [])).toBe(true)
    expect(sameCardTags(['a'], undefined)).toBe(false)
  })
})

describe('withCardTag / withoutCardTag', () => {
  test('adding is idempotent and canonical', () => {
    expect(withCardTag(undefined, ' Ramp ')).toEqual(['Ramp'])
    expect(withCardTag(['ramp'], 'ramp')).toEqual(['ramp'])
    expect(withCardTag(['zebra'], 'apple')).toEqual(['apple', 'zebra'])
  })

  test('withCardTags unions the added set onto the current one, canonical', () => {
    expect(withCardTags(undefined, ['Signed'])).toEqual(['Signed'])
    expect(withCardTags(['ramp', 'staple'], ['Signed', ' ramp '])).toEqual([
      'ramp',
      'Signed',
      'staple',
    ])
    // A tag the card already carries is a no-op, so the delta emits nothing for it.
    expect(withCardTags(['ramp'], ['ramp'])).toEqual(['ramp'])
    // Case is identity: `Ramp` joins `ramp` rather than replacing it.
    expect(withCardTags(['ramp'], ['Ramp'])).toEqual(['ramp', 'Ramp'])
  })

  test('removing the last tag yields the stored empty form, undefined', () => {
    expect(withoutCardTag(['ramp'], 'ramp ')).toBeUndefined()
    expect(withoutCardTag(['ramp', 'staple'], 'ramp')).toEqual(['staple'])
    expect(withoutCardTag(['Ramp'], 'ramp')).toEqual(['Ramp'])
    expect(withoutCardTag(undefined, 'ramp')).toBeUndefined()
  })
})

describe('cardTagsDelta', () => {
  test('reports exactly the tags that changed, each half in canonical order', () => {
    expect(cardTagsDelta(['zebra', 'ramp', 'apple'], ['ramp', 'mango', 'binder'])).toEqual({
      added: ['binder', 'mango'],
      removed: ['apple', 'zebra'],
    })
  })

  test('an unchanged set — in any order — is an empty delta', () => {
    expect(cardTagsDelta(['b', 'a'], ['a', 'b'])).toEqual({ added: [], removed: [] })
    expect(cardTagsDelta(undefined, [])).toEqual({ added: [], removed: [] })
  })
})
