import { describe, expect, test } from 'bun:test'
import {
  cardMatchKey,
  frontFaceName,
  findMatchKey,
  parseSearchLines,
  partitionSearch,
} from '../../src/card/find-search'
import { makeScryfallCard } from '../test-utils'

describe('frontFaceName', () => {
  test('returns the name unchanged when there is no back face', () => {
    expect(frontFaceName('Lightning Bolt')).toBe('Lightning Bolt')
  })

  test('keeps only the front face of a double-faced name', () => {
    expect(frontFaceName('Bruce Banner // The Incredible Hulk')).toBe('Bruce Banner')
  })

  test('collapses a double-art name to its single front face', () => {
    expect(frontFaceName('Steam Vents // Steam Vents')).toBe('Steam Vents')
  })

  test('trims surrounding whitespace around the front face', () => {
    expect(frontFaceName('  Delver of Secrets //Insectile Aberration ')).toBe('Delver of Secrets')
  })

  test('handles a missing space around the separator', () => {
    expect(frontFaceName('Bruce Banner//The Incredible Hulk')).toBe('Bruce Banner')
  })
})

describe('findMatchKey', () => {
  test('lowercases and strips diacritics down to a literal key', () => {
    expect(findMatchKey('Lightning Bolt')).toBe('lightning bolt')
    expect(findMatchKey('Lim-Dûl the Necromancer')).toBe('lim-dul the necromancer')
  })

  test('a front-side query and a double-faced card share a key', () => {
    expect(findMatchKey('Bruce Banner')).toBe(findMatchKey('Bruce Banner // The Incredible Hulk'))
  })

  test('a back-side query does NOT match the double-faced card', () => {
    expect(findMatchKey('The Incredible Hulk')).not.toBe(
      findMatchKey('Bruce Banner // The Incredible Hulk'),
    )
  })

  test('a single printing and a double-art printing share a key', () => {
    expect(findMatchKey('Steam Vents')).toBe(findMatchKey('Steam Vents // Steam Vents'))
  })
})

describe('cardMatchKey', () => {
  test('prefers the resolved Scryfall name over the entry name', () => {
    const key = cardMatchKey({
      name: 'Entry Spelling',
      card: makeScryfallCard({ name: 'Résolved Name // Back Face' }),
    })
    expect(key).toBe('resolved name')
  })

  test('falls back to the entry name when nothing resolved', () => {
    expect(cardMatchKey({ name: 'Jötun Grunt', card: null })).toBe('jotun grunt')
  })
})

describe('parseSearchLines', () => {
  test('splits on newlines, trims, and drops blank lines', () => {
    const text = 'Lightning Bolt\n  Sol Ring  \n\n\nCounterspell\n'
    expect(parseSearchLines(text)).toEqual(['Lightning Bolt', 'Sol Ring', 'Counterspell'])
  })

  test('handles CRLF line endings', () => {
    expect(parseSearchLines('Bolt\r\nRing')).toEqual(['Bolt', 'Ring'])
  })

  test('returns an empty array for blank input', () => {
    expect(parseSearchLines('   \n\n  ')).toEqual([])
  })
})

describe('partitionSearch', () => {
  const present = new Set([findMatchKey('Lightning Bolt'), findMatchKey('Sol Ring')])

  test('separates found keys from not-found original lines', () => {
    const { found, notFound } = partitionSearch(
      ['Lightning Bolt', 'Black Lotus', 'Sol Ring'],
      present,
    )
    expect(found).toEqual(new Set(['lightning bolt', 'sol ring']))
    expect(notFound).toEqual(['Black Lotus'])
  })

  test('ignores blank lines in the query', () => {
    const { found, notFound } = partitionSearch(['   ', ''], present)
    expect(found.size).toBe(0)
    expect(notFound).toEqual([])
  })

  test('matches found lines case- and back-face-insensitively', () => {
    const { notFound } = partitionSearch(['LIGHTNING BOLT', 'sol ring // sol ring'], present)
    expect(notFound).toEqual([])
  })

  test('de-duplicates repeated not-found lines by match key', () => {
    const { notFound } = partitionSearch(['Black Lotus', 'black lotus', 'Mox Pearl'], present)
    expect(notFound).toEqual(['Black Lotus', 'Mox Pearl'])
  })
})
