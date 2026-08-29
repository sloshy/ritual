import { describe, expect, test } from 'bun:test'
import { isCardCandidate, readCardLine } from '../../src/card/card-line-read'
import type { ListType } from '../../src/list/list-type'

/**
 * The file-scanning half of the grammar: which lines are offered to the
 * tokenizer, and how much of its refusal the mutation paths tolerate.
 */
describe('isCardCandidate', () => {
  const cases: readonly [ListType, string, boolean][] = [
    ['deck', '1 Sol Ring (LEA:1)', true],
    ['deck', '4x Sol Ring', true],
    ['deck', '- 2 Sol Ring (LEA:1)', true],
    // Prose in a deck stays prose: without a quantity the tokenizer would read
    // the whole sentence as a name-only card.
    ['deck', 'Sol Ring is the best card in the format', false],
    ['deck', '- Sol Ring', false],
    ['deck', '## Main', false],
    ['collection', '- Sol Ring (LEA:1)', true],
    ['collection', '- 3 Sol Ring (LEA:1)', true],
    ['collection', 'Sol Ring (LEA:1)', false],
    // The bullet is the tokenizer's own `-\s+`, not a narrower spelling of it:
    // a line it reads perfectly must not be scanned past as prose.
    ['collection', '-\tSol Ring (LEA:1)', true],
    ['collection', '-  Sol Ring (LEA:1)', true],
    ['collection', '-Sol Ring (LEA:1)', false],
    ['wanted', '- Sol Ring', true],
    ['wanted', 'These are the ones I still need', false],
  ]
  for (const [type, line, expected] of cases) {
    test(`${type}: ${JSON.stringify(line)} → ${expected}`, () => {
      expect(isCardCandidate(type, line)).toBe(expected)
    })
  }
})

describe('readCardLine', () => {
  test('reads a candidate line the grammar accepts', () => {
    expect(readCardLine('collection', '- Sol Ring (LEA:270) [foil] &4')).toEqual({
      tokens: {
        quantity: 1,
        name: 'Sol Ring',
        printing: { set: 'lea', collectorNumber: '270' },
        finish: 'foil',
        cardId: 4,
      },
    })
  })

  test('a non-candidate line is not a card line, however card-shaped it reads', () => {
    // The tokenizer alone would happily read this as a name-only card.
    expect(readCardLine('collection', 'Sol Ring (LEA:270)')).toBeUndefined()
  })

  test('a refusal that loses the line is not recovered', () => {
    expect(readCardLine('collection', '- Sol Ring (LEA:270) [zz]')).toBeUndefined()
    expect(readCardLine('wanted', '- Sol Ring (LEA:270) [LP]')).toBeUndefined()
  })

  test('a self-conflicting labels token is recovered, and reported separately', () => {
    // `set-label` exists to replace exactly this token, so a line the mutation
    // paths cannot find is a line the user cannot repair.
    const read = readCardLine('collection', '- Sol Ring (C21:263) [sale,keep] &1')
    expect(read?.invalidLabels).toBe('sale,keep')
    expect(read?.tokens).toMatchObject({ name: 'Sol Ring', cardId: 1 })
    // The refused token is reported, never silently kept as a label override.
    expect(read?.tokens.labels).toBeUndefined()
  })

  test('the recovered read keeps every other token on the line', () => {
    const read = readCardLine('deck', '2 Sol Ring (LEA:1) [keep,proxy] [foil] {mine} &9')
    expect(read?.invalidLabels).toBe('keep,proxy')
    expect(read?.tokens).toMatchObject({
      quantity: 2,
      name: 'Sol Ring',
      finish: 'foil',
      note: 'mine',
      cardId: 9,
    })
  })
})
