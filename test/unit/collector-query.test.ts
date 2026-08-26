import { describe, expect, test } from 'bun:test'
import {
  filterPrintingsByQuery,
  matchesCollectorQuery,
  parseCollectorQuery,
  type FilterablePrinting,
} from '../../src/card/collector-query'

describe('parseCollectorQuery', () => {
  test('a colon splits the input into its set and number halves', () => {
    expect(parseCollectorQuery('MKM:123')).toEqual({
      kind: 'split',
      setTerm: 'mkm',
      numberTerm: '123',
    })
  })

  test('either half of a colon query may be empty', () => {
    expect(parseCollectorQuery('mkm:')).toEqual({ kind: 'split', setTerm: 'mkm', numberTerm: '' })
    expect(parseCollectorQuery(':123')).toEqual({ kind: 'split', setTerm: '', numberTerm: '123' })
  })

  test('whitespace around a colon is trimmed off both halves', () => {
    expect(parseCollectorQuery('mkm : 123')).toEqual({
      kind: 'split',
      setTerm: 'mkm',
      numberTerm: '123',
    })
  })

  test('the first colon wins: it splits before whitespace, and later colons stay put', () => {
    // A colon anywhere makes the whole left side the set half, spaces and all —
    // such a query can never match a set code, which is fine: it's malformed.
    expect(parseCollectorQuery('mkm 12:3')).toEqual({
      kind: 'split',
      setTerm: 'mkm 12',
      numberTerm: '3',
    })
    expect(parseCollectorQuery('a:b:c')).toEqual({ kind: 'split', setTerm: 'a', numberTerm: 'b:c' })
  })

  test('whitespace splits the input the same way a colon does', () => {
    expect(parseCollectorQuery('se 456')).toEqual({
      kind: 'split',
      setTerm: 'se',
      numberTerm: '456',
    })
  })

  test('a trailing space settles the set half with no number typed yet', () => {
    expect(parseCollectorQuery('mkm ')).toEqual({ kind: 'split', setTerm: 'mkm', numberTerm: '' })
  })

  test('tokens past the second are ignored — nothing else matches them', () => {
    expect(parseCollectorQuery('mkm 123 456')).toEqual({
      kind: 'split',
      setTerm: 'mkm',
      numberTerm: '123',
    })
  })

  test('a lone token stays ambiguous, to be matched against either half', () => {
    expect(parseCollectorQuery('12')).toEqual({ kind: 'single', term: '12' })
    expect(parseCollectorQuery('')).toEqual({ kind: 'single', term: '' })
  })

  test('only a trailing space settles the set half — a leading one says nothing', () => {
    // A pasted or fat-fingered leading space must not turn a collector-number
    // search into a set-code one that matches nothing.
    expect(parseCollectorQuery(' 123')).toEqual({ kind: 'single', term: '123' })
    expect(parseCollectorQuery('  ')).toEqual({ kind: 'single', term: '' })
  })
})

describe('matchesCollectorQuery', () => {
  const solRing = { setTerm: 'ltc', numTerm: '284' }
  const dsPromo = { setTerm: 'pdsk', numTerm: '12' }

  test('a single term matches the set code as a substring', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('ds'), dsPromo)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('ds'), solRing)).toBe(false)
  })

  test('a single term matches the collector number as a prefix only', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('28'), solRing)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('84'), solRing)).toBe(false)
  })

  test('a split query requires both halves to match', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('ds 12'), dsPromo)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('ds 28'), dsPromo)).toBe(false)
    expect(matchesCollectorQuery(parseCollectorQuery('ltc 12'), dsPromo)).toBe(false)
  })

  test('an empty half of a split query matches everything', () => {
    expect(matchesCollectorQuery(parseCollectorQuery(':12'), dsPromo)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('pdsk:'), dsPromo)).toBe(true)
  })

  test('an empty single term matches everything', () => {
    // Reachable through the CLI's suggest wrapper with whitespace-only input.
    expect(matchesCollectorQuery(parseCollectorQuery('  '), solRing)).toBe(true)
  })
})

describe('filterPrintingsByQuery', () => {
  const printings: FilterablePrinting[] = [
    { set: 'LTC', collector_number: '284' },
    { set: 'pdsk', collector_number: '12' },
    { set: 'dsk', collector_number: '120' },
    { set: 'mkm', collector_number: '123' },
    { set: 'mkm', collector_number: '2A' },
  ]

  test('blank input returns the very same list, untouched', () => {
    // Same reference, not a copy — callers' memos rely on `===` stability.
    expect(filterPrintingsByQuery('', printings)).toBe(printings)
    expect(filterPrintingsByQuery('   ', printings)).toBe(printings)
  })

  test('matching is case-insensitive on both printing fields', () => {
    expect(filterPrintingsByQuery('ltc:284', printings)).toEqual([
      { set: 'LTC', collector_number: '284' },
    ])
    // Letter-bearing collector numbers are routine; the printing side folds too.
    expect(filterPrintingsByQuery('mkm 2a', printings)).toEqual([
      { set: 'mkm', collector_number: '2A' },
    ])
  })

  test('a single token matches either half, preserving input order', () => {
    expect(filterPrintingsByQuery('12', printings)).toEqual([
      { set: 'pdsk', collector_number: '12' },
      { set: 'dsk', collector_number: '120' },
      { set: 'mkm', collector_number: '123' },
    ])
  })
})
