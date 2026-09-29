import { describe, test, expect } from 'bun:test'
import { findLineBreak, hasLineBreak, singleLineText } from '../../src/util/single-line'

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
    expect(performance.now() - started).toBeLessThan(3000)
  })
})

describe('hasLineBreak', () => {
  test.each([
    ['LF', 'a\nb'],
    ['CR', 'a\rb'],
    ['VT', 'a\u000bb'],
    ['FF', 'a\fb'],
    ['NEL', 'a\u0085b'],
    ['line separator', 'a\u2028b'],
    ['paragraph separator', 'a\u2029b'],
  ])('is true for a %s', (_label, text) => {
    expect(hasLineBreak(text)).toBe(true)
  })

  test('is false for a tab or NUL, which cannot split a line', () => {
    expect(hasLineBreak('a\tb\u0000c')).toBe(false)
  })
})

describe('findLineBreak', () => {
  test('names the path of a broken string, however deep', () => {
    const body = {
      changes: [
        { action: 'add', cardName: 'Sol Ring' },
        { action: 'move-from', cardName: 'Bolt', to: { type: 'deck', name: 'Burn\nX' } },
      ],
    }
    expect(findLineBreak(body, 'body')).toBe('body.changes[1].to.name')
    expect(findLineBreak(['Main', 'Maybe\nboard'], 'sectionOrder')).toBe('sectionOrder[1]')
  })

  test('reports the first offender in document order', () => {
    expect(findLineBreak({ a: ['ok', 'x\ny'], b: 'z\nw' }, 'r')).toBe('r.a[1]')
  })

  test('is null when every string is single-line, and ignores non-strings', () => {
    const clean = { cardName: 'Sol Ring', cardId: 3, tags: ['Ramp'], note: null, ids: [1, 2] }
    expect(findLineBreak(clean, 'c')).toBeNull()
  })

  test('walks a hostile million-deep nesting without overflowing the stack', () => {
    let nested: unknown = 'x\ny'
    for (let depth = 0; depth < 1_000_000; depth++) nested = [nested]
    expect(findLineBreak(nested, 'r')).toStartWith('r[0][0]')
  })
})
