import { describe, expect, test } from 'bun:test'
import {
  extractCardTypeTags,
  formatCardTypeForDisplay,
  matchesCardTypes,
  parseCardTypesInput,
  scanCardTypeInput,
} from '../../src/site/card-types'

describe('extractCardTypeTags', () => {
  test('splits a type line into lowercase types and subtypes', () => {
    expect(extractCardTypeTags('Artifact Creature — Robot Elf')).toEqual([
      'artifact',
      'creature',
      'robot',
      'elf',
    ])
  })

  test('includes supertypes', () => {
    expect(extractCardTypeTags('Legendary Creature — Elf Druid')).toEqual([
      'legendary',
      'creature',
      'elf',
      'druid',
    ])
  })

  test('keeps "Time Lord" as a single tag (multi-word tags are emitted first)', () => {
    expect(extractCardTypeTags('Legendary Creature — Time Lord')).toEqual([
      'time lord',
      'legendary',
      'creature',
    ])
  })

  test('merges both faces of a double-faced card and de-duplicates', () => {
    const tags = extractCardTypeTags('Creature — Human Werewolf // Creature — Werewolf')
    expect(tags).toEqual(['creature', 'human', 'werewolf'])
  })

  test('handles a bare type line with no subtypes', () => {
    expect(extractCardTypeTags('Artifact')).toEqual(['artifact'])
  })

  test('empty type line yields no tags', () => {
    expect(extractCardTypeTags('')).toEqual([])
  })
})

// The three match modes are pinned against `matchesSelection` in
// test/unit/site/filter-mode.test.ts; `matchesCardTypes` only adds that the tags
// extracted from the type line are what gets matched.
describe('matchesCardTypes', () => {
  const typeLine = 'Artifact Creature — Robot'

  test('matches the tags extracted from the type line under the given mode', () => {
    expect(matchesCardTypes(typeLine, ['artifact', 'enchantment'], 'include')).toBe(true)
    expect(matchesCardTypes(typeLine, ['enchantment', 'land'], 'include')).toBe(false)
    expect(matchesCardTypes(typeLine, ['artifact', 'creature'], 'exact')).toBe(true)
    expect(matchesCardTypes(typeLine, ['enchantment'], 'exclude')).toBe(true)
  })

  test('matches the multi-word "time lord" tag', () => {
    expect(matchesCardTypes('Creature — Time Lord', ['time lord'], 'include')).toBe(true)
    expect(matchesCardTypes('Creature — Time Lord', ['time'], 'include')).toBe(false)
  })
})

describe('formatCardTypeForDisplay', () => {
  test('title-cases each word', () => {
    expect(formatCardTypeForDisplay('artifact')).toBe('Artifact')
    expect(formatCardTypeForDisplay('time lord')).toBe('Time Lord')
  })
})

describe('scanCardTypeInput', () => {
  test('splits completed tags on whitespace and commas, keeping the trailing partial as remainder', () => {
    expect(scanCardTypeInput('creature, artifact elf')).toEqual({
      tags: ['creature', 'artifact'],
      remainder: 'elf',
    })
  })

  test('a closed quote completes a multi-word tag immediately', () => {
    expect(scanCardTypeInput('"Time Lord"')).toEqual({ tags: ['time lord'], remainder: '' })
  })

  test('a token typed after a closed quote becomes the remainder', () => {
    expect(scanCardTypeInput('"Time Lord" creature')).toEqual({
      tags: ['time lord'],
      remainder: 'creature',
    })
  })

  test('an open quote keeps the partial (with quote) as the remainder', () => {
    expect(scanCardTypeInput('creature "Time Lo')).toEqual({
      tags: ['creature'],
      remainder: '"Time Lo',
    })
  })

  test('a fully typed bare token stays as remainder until a separator', () => {
    expect(scanCardTypeInput('creature')).toEqual({ tags: [], remainder: 'creature' })
  })
})

describe('parseCardTypesInput', () => {
  test('commits the trailing token', () => {
    expect(parseCardTypesInput('creature elf')).toEqual(['creature', 'elf'])
  })

  test('commits an unterminated quoted token without the quote', () => {
    expect(parseCardTypesInput('"Time Lord')).toEqual(['time lord'])
  })

  test('commits a fully closed quoted token', () => {
    expect(parseCardTypesInput('"Time Lord"')).toEqual(['time lord'])
  })

  test('de-duplicates', () => {
    expect(parseCardTypesInput('elf elf')).toEqual(['elf'])
  })
})
