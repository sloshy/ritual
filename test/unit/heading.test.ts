import { describe, test, expect } from 'bun:test'
import { headingName, sectionHeading, singleLineText, titleHeading } from '../../src/list/heading'

describe('singleLineText', () => {
  test.each([
    ['LF', 'Foo\nBar'],
    ['CRLF with surrounding spaces', 'Foo \r\n Bar'],
    ['lone CR', 'Foo\rBar'],
    ['NEL', 'Foo\u0085Bar'],
    ['line separator', 'Foo\u2028Bar'],
    ['paragraph separator', 'Foo\u2029Bar'],
    ['tab', 'Foo\tBar'],
    ['NUL', 'Foo\u0000Bar'],
    ['DEL', 'Foo\u007fBar'],
    ['C1 CSI', 'Foo\u009bBar'],
    ['a run of blank lines', 'Foo\n\n\nBar'],
  ])('folds a %s to one space', (_label, input) => {
    expect(singleLineText(input)).toBe('Foo Bar')
  })

  test('leaves a single-line name byte-for-byte alone', () => {
    const name = '  Atraxa: Praetors’ Voice — #1 ## Main  '
    expect(singleLineText(name)).toBe(name)
  })
})

describe('singleLineText on hostile input', () => {
  test('folds a long run of spaces before a break in linear time', () => {
    // A `\s*`-anchored pattern backtracks quadratically here: 80k spaces took ~10s.
    const started = performance.now()
    expect(singleLineText(`${' '.repeat(200_000)}x\n`)).toBe(`${' '.repeat(200_000)}x `)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('headingName', () => {
  test('is what parseHeading reads back: folded, then trimmed', () => {
    expect(headingName('\n Burn \n')).toBe('Burn')
  })
})

describe('titleHeading / sectionHeading', () => {
  test('a title smuggling a card line stays one heading line', () => {
    expect(titleHeading('Burn\n1 Black Lotus &99')).toBe('# Burn 1 Black Lotus &99')
  })

  test('a section smuggling a header stays one heading line', () => {
    expect(sectionHeading('Main\n## Sideboard')).toBe('## Main ## Sideboard')
  })
})
