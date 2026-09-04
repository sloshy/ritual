import { describe, expect, test } from 'bun:test'
import {
  matchesCardTags,
  parseCardTagFilterInput,
  scanCardTagInput,
} from '../../../src/site/card-tag-filter'
import { scanSeparatedTokens } from '../../../src/site/TagsInput'

describe('scanSeparatedTokens', () => {
  const commit = (head: string) => head.split(';').map((s) => s.trim())

  test('with no separator nothing commits and the whole value stays the draft', () => {
    expect(scanSeparatedTokens('Card Draw', ';', commit)).toEqual({
      tags: [],
      remainder: 'Card Draw',
    })
  })

  test('a trailing separator commits the head and leaves an empty draft', () => {
    expect(scanSeparatedTokens('ramp; staple;', ';', commit)).toEqual({
      tags: ['ramp', 'staple'],
      remainder: '',
    })
  })

  test('only the last separator splits; the tail after it is the verbatim draft', () => {
    expect(scanSeparatedTokens('ramp; st', ';', commit)).toEqual({
      tags: ['ramp'],
      remainder: ' st',
    })
  })

  test('a multi-character separator is skipped whole', () => {
    expect(scanSeparatedTokens('a::b::c', '::', commit).remainder).toBe('c')
  })
})

describe('matchesCardTags', () => {
  test('an empty selection leaves every card in — the filter is inactive', () => {
    expect(matchesCardTags(undefined, [], 'include')).toBe(true)
    expect(matchesCardTags(['ramp'], [], 'exclude')).toBe(true)
  })

  test('identity is case-sensitive: a Ramp selection does not match a ramp card', () => {
    expect(matchesCardTags(['ramp'], ['Ramp'], 'include')).toBe(false)
    expect(matchesCardTags(['ramp'], ['Ramp'], 'exact')).toBe(false)
    expect(matchesCardTags(['ramp'], ['ramp'], 'include')).toBe(true)
  })

  test('include keeps a card carrying any selected tag', () => {
    expect(matchesCardTags(['Card Draw'], ['ramp', 'Card Draw'], 'include')).toBe(true)
    expect(matchesCardTags(['staple'], ['ramp', 'Card Draw'], 'include')).toBe(false)
  })

  test('exclude drops a card carrying any selected tag', () => {
    expect(matchesCardTags(['Card Draw'], ['Card Draw'], 'exclude')).toBe(false)
    expect(matchesCardTags(['staple'], ['Card Draw'], 'exclude')).toBe(true)
  })

  test('exact demands every selected tag', () => {
    expect(matchesCardTags(['ramp', 'staple'], ['ramp', 'staple'], 'exact')).toBe(true)
    expect(matchesCardTags(['ramp'], ['ramp', 'staple'], 'exact')).toBe(false)
  })

  test('an untagged card is dropped by include and kept by exclude', () => {
    expect(matchesCardTags(undefined, ['ramp'], 'include')).toBe(false)
    expect(matchesCardTags(undefined, ['ramp'], 'exclude')).toBe(true)
  })
})

describe('scanCardTagInput', () => {
  test('commits on a comma only — a space inside a tag never splits', () => {
    expect(scanCardTagInput('Card Draw')).toEqual({ tags: [], remainder: 'Card Draw' })
    expect(scanCardTagInput('Card Draw, Ra')).toEqual({ tags: ['Card Draw'], remainder: ' Ra' })
  })

  test('the typed case survives', () => {
    expect(scanCardTagInput('Ramp,').tags).toEqual(['Ramp'])
    expect(scanCardTagInput('ramp,').tags).toEqual(['ramp'])
  })

  test('a leading # is tolerated on the way in and never part of the chip', () => {
    expect(scanCardTagInput('#ramp,').tags).toEqual(['ramp'])
  })

  test('a refused token is dropped and the rest still commit', () => {
    expect(scanCardTagInput('R&D, ').tags).toEqual([])
    expect(scanCardTagInput('ramp, R&D, staple,').tags).toEqual(['ramp', 'staple'])
  })

  test('committed tags dedupe by whitespace fold only — case makes two tags', () => {
    expect(scanCardTagInput('ramp, ramp,').tags).toEqual(['ramp'])
    expect(scanCardTagInput('Card  Draw, Card Draw,').tags).toEqual(['Card Draw'])
    expect(scanCardTagInput('Ramp, ramp,').tags).toEqual(['Ramp', 'ramp'])
  })
})

describe('parseCardTagFilterInput', () => {
  test('commits the trailing token too', () => {
    expect(parseCardTagFilterInput('ramp, Card Draw')).toEqual(['ramp', 'Card Draw'])
  })

  test('keeps the typed order rather than the file collation', () => {
    expect(parseCardTagFilterInput('staple, ramp')).toEqual(['staple', 'ramp'])
  })

  test('a malformed draft adds nothing rather than committing a bad tag', () => {
    expect(parseCardTagFilterInput('R&D')).toEqual([])
  })

  test('one refused entry does not discard the well-formed ones', () => {
    expect(parseCardTagFilterInput('ramp, R&D, staple')).toEqual(['ramp', 'staple'])
  })
})
