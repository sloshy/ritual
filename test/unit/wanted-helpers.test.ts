import { describe, test, expect } from 'bun:test'
import { parseWantedListFile, formatWantedListLine } from '../../src/commands/wanted-helpers'

describe('parseWantedListFile', () => {
  test('parses a name-only entry', () => {
    const { entries, warnings } = parseWantedListFile('- Lightning Bolt\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Lightning Bolt', quantity: 1 })
    expect(warnings).toHaveLength(0)
  })

  test('parses an entry with a specific printing', () => {
    const { entries } = parseWantedListFile('- Sol Ring (LEA:232)\n')
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', set: 'LEA', collectorNumber: '232' })
  })

  test('parses an entry with a foil finish', () => {
    const { entries } = parseWantedListFile('- Sol Ring [foil]\n')
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', finish: 'foil' })
  })

  test('parses an entry with printing and finish', () => {
    const { entries } = parseWantedListFile('- Sol Ring (LEA:232) [etched]\n')
    expect(entries[0]).toMatchObject({
      name: 'Sol Ring',
      set: 'LEA',
      collectorNumber: '232',
      finish: 'etched',
    })
  })

  test('parses an entry with a note', () => {
    const { entries } = parseWantedListFile('- Sol Ring {signed}\n')
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', note: 'signed' })
  })

  test('parses multiple entries', () => {
    const content = '- Lightning Bolt\n- Sol Ring [foil]\n- Black Lotus (LEA:232)\n'
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(3)
  })

  test('skips non-list lines', () => {
    const content = '# My Wanted List\n\nSome text\n- Lightning Bolt\n'
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
  })

  test('silently skips nearly-empty list lines (no content after "- ")', () => {
    // '- \n' trims to '-', which does not start with '- ', so it is skipped without a warning.
    // The regex is permissive: any line starting with '- ' followed by at least one character
    // will always parse successfully, so warnings are only produced for edge cases.
    const { entries, warnings } = parseWantedListFile('- \n')
    expect(entries).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  test('handles empty content', () => {
    const { entries, warnings } = parseWantedListFile('')
    expect(entries).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })
})

describe('formatWantedListLine', () => {
  test('formats a name-only entry', () => {
    const line = formatWantedListLine('Lightning Bolt')
    expect(line).toBe('- Lightning Bolt\n')
  })

  test('includes printing when provided', () => {
    const line = formatWantedListLine('Sol Ring', { set: 'LEA', collectorNumber: '232' })
    expect(line).toBe('- Sol Ring (LEA:232)\n')
  })

  test('includes foil finish', () => {
    const line = formatWantedListLine('Sol Ring', undefined, 'foil')
    expect(line).toBe('- Sol Ring [foil]\n')
  })

  test('omits [nonfoil] tag (nonfoil is implicit)', () => {
    const line = formatWantedListLine('Sol Ring', undefined, 'nonfoil')
    expect(line).not.toContain('[nonfoil]')
  })

  test('includes printing and etched finish', () => {
    const line = formatWantedListLine('Sol Ring', { set: 'CMR', collectorNumber: '1' }, 'etched')
    expect(line).toBe('- Sol Ring (CMR:1) [etched]\n')
  })

  test('includes a note', () => {
    const line = formatWantedListLine('Sol Ring', undefined, undefined, 'signed')
    expect(line).toBe('- Sol Ring {signed}\n')
  })

  test('set code is uppercased', () => {
    const line = formatWantedListLine('Dragon', { set: 'mh2', collectorNumber: '100' })
    expect(line).toContain('(MH2:100)')
  })
})
