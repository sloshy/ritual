import { describe, expect, test } from 'bun:test'
import { parseMoxfieldPrimer, extractPrimerCardNames } from '../../src/primer-parser'

describe('parseMoxfieldPrimer', () => {
  test('passes through non-directive lines unchanged, preserving markdown and [[...]] tokens', () => {
    const input = '**bold** and *italic* text with [[Sol Ring]] and [[youtube:abc123]]'
    const { markdown } = parseMoxfieldPrimer(input)
    expect(markdown).toBe(input)
  })

  test('strips ===accordion and ===endaccordion lines, keeps inner content', () => {
    const input = '===accordion\nsome content\n===endaccordion'
    const { markdown } = parseMoxfieldPrimer(input)
    expect(markdown).toBe('some content')
    expect(markdown).not.toContain('===accordion')
    expect(markdown).not.toContain('===endaccordion')
  })

  test('converts ===panel: to H2 heading at top level', () => {
    const input = '===panel: My Section\ncontent\n===endpanel'
    const { markdown, headings } = parseMoxfieldPrimer(input)
    expect(markdown).toContain('## My Section')
    expect(headings).toHaveLength(1)
    expect(headings[0]!.level).toBe(2)
    expect(headings[0]!.text).toBe('My Section')
  })

  test('converts nested panels to progressively deeper headings', () => {
    const input = [
      '===panel: Outer',
      'outer content',
      '===panel: Inner',
      'inner content',
      '===endpanel',
      '===endpanel',
    ].join('\n')
    const { markdown, headings } = parseMoxfieldPrimer(input)
    expect(markdown).toContain('## Outer')
    expect(markdown).toContain('### Inner')
    expect(headings[0]!.level).toBe(2)
    expect(headings[1]!.level).toBe(3)
  })

  test('depth resets after ===endpanel', () => {
    const input = ['===panel: First', '===endpanel', '===panel: Second', '===endpanel'].join('\n')
    const { headings } = parseMoxfieldPrimer(input)
    expect(headings[0]!.level).toBe(2)
    expect(headings[1]!.level).toBe(2)
  })

  test('caps heading level at H6 for deeply nested panels', () => {
    const lines: string[] = []
    for (let i = 0; i < 10; i++) lines.push(`===panel: Level ${i + 1}`)
    for (let i = 0; i < 10; i++) lines.push('===endpanel')
    const { headings } = parseMoxfieldPrimer(lines.join('\n'))
    const levels = headings.map((h) => h.level)
    expect(Math.max(...levels)).toBeLessThanOrEqual(6)
  })

  test('strips ===endpanel lines from output', () => {
    const { markdown } = parseMoxfieldPrimer('===panel: X\n===endpanel')
    expect(markdown).not.toContain('===endpanel')
  })

  test('extracts card names but not youtube tokens', () => {
    const input = '[[Sol Ring]] and [[youtube:abc]] and [[Command Tower]]'
    const { cardNames } = parseMoxfieldPrimer(input)
    expect(cardNames).toContain('Sol Ring')
    expect(cardNames).toContain('Command Tower')
    expect(cardNames).not.toContain('youtube:abc')
    expect(cardNames.some((n) => n.startsWith('youtube:'))).toBe(false)
  })

  test('generates heading ids from text', () => {
    const { headings } = parseMoxfieldPrimer('===panel: My Cool Section!\n===endpanel')
    expect(headings[0]!.id).toBe('my-cool-section')
  })

  test('collapses excess blank lines', () => {
    const input = 'a\n\n\n\n\nb'
    const { markdown } = parseMoxfieldPrimer(input)
    expect(markdown).not.toMatch(/\n{3,}/)
  })

  test('handles accordion wrapping a panel correctly', () => {
    const input = [
      '===accordion',
      '===panel: Wrapped Heading',
      'body text',
      '===endpanel',
      '===endaccordion',
    ].join('\n')
    const { markdown, headings } = parseMoxfieldPrimer(input)
    expect(markdown).toContain('## Wrapped Heading')
    expect(markdown).toContain('body text')
    expect(headings).toHaveLength(1)
    expect(markdown).not.toContain('===accordion')
  })
})

describe('extractPrimerCardNames', () => {
  test('returns empty array for no card links', () => {
    expect(extractPrimerCardNames('no links here')).toEqual([])
  })

  test('extracts card names', () => {
    const names = extractPrimerCardNames('[[Sol Ring]] and [[Command Tower]]')
    expect(names).toContain('Sol Ring')
    expect(names).toContain('Command Tower')
  })

  test('ignores youtube tokens', () => {
    const names = extractPrimerCardNames('[[youtube:abc123]]')
    expect(names).toHaveLength(0)
  })

  test('deduplicates case-insensitively, preserves first occurrence case', () => {
    const names = extractPrimerCardNames('[[Sol Ring]] and [[sol ring]]')
    expect(names).toHaveLength(1)
    expect(names[0]).toBe('Sol Ring')
  })
})
