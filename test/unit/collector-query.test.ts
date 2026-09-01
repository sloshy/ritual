import { describe, expect, test } from 'bun:test'
import {
  filterPrintingsByQuery,
  matchesCollectorQuery,
  parseCollectorQuery,
  type FilterablePrinting,
} from '../../src/card/collector-query'

describe('parseCollectorQuery', () => {
  test('a colon splits the input into an explicit set term and number term', () => {
    expect(parseCollectorQuery('MKM:123')).toEqual({
      terms: [
        { text: 'mkm', field: 'set' },
        { text: '123', field: 'number' },
      ],
    })
  })

  test('an empty half of a colon query contributes no term', () => {
    expect(parseCollectorQuery('mkm:')).toEqual({ terms: [{ text: 'mkm', field: 'set' }] })
    expect(parseCollectorQuery(':123')).toEqual({ terms: [{ text: '123', field: 'number' }] })
  })

  test('whitespace around a colon is trimmed off both halves', () => {
    expect(parseCollectorQuery('mkm : 123')).toEqual({
      terms: [
        { text: 'mkm', field: 'set' },
        { text: '123', field: 'number' },
      ],
    })
  })

  test('the first colon names the tokens it joins; later colons stay put', () => {
    // Only the tokens either side of the colon are pinned by it — anything
    // further out is still classified on its own, so a set code can be typed
    // onto a number already in the box.
    expect(parseCollectorQuery('123 mkm:12')).toEqual({
      terms: [
        { text: '123', field: 'either' },
        { text: 'mkm', field: 'set' },
        { text: '12', field: 'number' },
      ],
    })
    expect(parseCollectorQuery('a:b:c')).toEqual({
      terms: [
        { text: 'a', field: 'set' },
        { text: 'b:c', field: 'number' },
      ],
    })
  })

  test('a colon overrides the guess on both sides, not just the number half', () => {
    // Without the colon `284` would stay open to either half; with it, the
    // token before the colon is a set code and nothing else.
    expect(parseCollectorQuery('284:')).toEqual({ terms: [{ text: '284', field: 'set' }] })
  })

  test('an all-letter token searches set codes; anything else stays open to both', () => {
    // Numeric set codes (2XM, 40K, 10E) and letter-bearing collector numbers
    // (123a, M10-146) are both routine, so only a pure word can be pinned.
    expect(parseCollectorQuery('se')).toEqual({ terms: [{ text: 'se', field: 'set' }] })
    expect(parseCollectorQuery('12')).toEqual({ terms: [{ text: '12', field: 'either' }] })
    expect(parseCollectorQuery('m10-146')).toEqual({
      terms: [{ text: 'm10-146', field: 'either' }],
    })
    expect(parseCollectorQuery('')).toEqual({ terms: [] })
  })

  test('tokens are classified independently, whatever order they were typed in', () => {
    const forward = parseCollectorQuery('fic 123')
    expect(forward).toEqual({
      terms: [
        { text: 'fic', field: 'set' },
        { text: '123', field: 'either' },
      ],
    })
    expect(parseCollectorQuery('123 fic').terms).toEqual([...forward.terms].reverse())
  })

  test('every token counts — a third one narrows further rather than being dropped', () => {
    expect(parseCollectorQuery('mkm 123 456').terms).toEqual([
      { text: 'mkm', field: 'set' },
      { text: '123', field: 'either' },
      { text: '456', field: 'either' },
    ])
  })

  test('stray whitespace contributes nothing, leading or trailing', () => {
    expect(parseCollectorQuery(' 123')).toEqual({ terms: [{ text: '123', field: 'either' }] })
    expect(parseCollectorQuery('mkm ')).toEqual({ terms: [{ text: 'mkm', field: 'set' }] })
    expect(parseCollectorQuery('  ')).toEqual({ terms: [] })
  })
})

describe('matchesCollectorQuery', () => {
  const solRing = { setTerm: 'ltc', numTerm: '284' }
  const dsPromo = { setTerm: 'pdsk', numTerm: '12' }
  const doubleMasters = { setTerm: '2xm', numTerm: '331' }

  test('a letter-leading term matches the set code as a substring only', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('ds'), dsPromo)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('ds'), solRing)).toBe(false)
  })

  test('a digit-leading term matches a numeric set code as well as a collector number', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('28'), solRing)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('84'), solRing)).toBe(false)
    expect(matchesCollectorQuery(parseCollectorQuery('2xm'), doubleMasters)).toBe(true)
  })

  test('an explicit number term never matches the set code', () => {
    expect(matchesCollectorQuery(parseCollectorQuery(':2xm'), doubleMasters)).toBe(false)
  })

  test('padding is ignored on both sides of the number comparison', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('pdsk:012'), dsPromo)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('0284'), solRing)).toBe(true)
    // The printing's own number may be the padded one.
    expect(
      matchesCollectorQuery(parseCollectorQuery('12'), { setTerm: 'ltr', numTerm: '012' }),
    ).toBe(true)
  })

  test('an unpadded term is exact — `012` is card 12, not the start of 120', () => {
    expect(
      matchesCollectorQuery(parseCollectorQuery(':012'), { setTerm: 'dsk', numTerm: '120' }),
    ).toBe(false)
  })

  test('a colon-pinned set term never matches the collector number', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('284:'), solRing)).toBe(false)
  })

  test('a third term narrows rather than being ignored', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('ds 12 ltc'), dsPromo)).toBe(false)
  })

  test('an open term still has to be answered by one half or the other', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('2xm 999'), doubleMasters)).toBe(false)
  })

  test('a letter-bearing collector number is still reachable by typing it', () => {
    const theList = { setTerm: 'plst', numTerm: 'm10-146' }
    expect(matchesCollectorQuery(parseCollectorQuery('m10-146'), theList)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('plst m10'), theList)).toBe(true)
  })

  test('every term must be answered, in whichever order they were typed', () => {
    expect(matchesCollectorQuery(parseCollectorQuery('ds 12'), dsPromo)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('12 ds'), dsPromo)).toBe(true)
    expect(matchesCollectorQuery(parseCollectorQuery('ds 28'), dsPromo)).toBe(false)
    expect(matchesCollectorQuery(parseCollectorQuery('ltc 12'), dsPromo)).toBe(false)
  })

  test('a query with no terms matches everything', () => {
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
    // A bare colon parses to no terms at all, so it takes the same fast path.
    expect(filterPrintingsByQuery(':', printings)).toBe(printings)
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

  test('a number typed before its set code narrows just as well as after it', () => {
    expect(filterPrintingsByQuery('120 dsk', printings)).toEqual([
      { set: 'dsk', collector_number: '120' },
    ])
  })

  test('terms are ANDed, so a pair no single printing answers matches nothing', () => {
    expect(filterPrintingsByQuery('ltc 12', printings)).toEqual([])
  })

  test('a single token matches either half, preserving input order', () => {
    expect(filterPrintingsByQuery('12', printings)).toEqual([
      { set: 'pdsk', collector_number: '12' },
      { set: 'dsk', collector_number: '120' },
      { set: 'mkm', collector_number: '123' },
    ])
  })
})
