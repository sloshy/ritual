import { describe, expect, it } from 'bun:test'
import { parseCollectionFile } from '../../src/commands/price-collection'

describe('parseCollectionFile', () => {
  it('parse basic entry — name, set, collectorNumber', () => {
    const result = parseCollectionFile('- Lightning Bolt (LEA:161)')

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.name).toBe('Lightning Bolt')
    expect(result.entries[0]!.set).toBe('LEA')
    expect(result.entries[0]!.collectorNumber).toBe('161')
  })

  it('parse foil entry — finish = foil', () => {
    const result = parseCollectionFile('- Lightning Bolt (LEA:161) [foil]')

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.finish).toBe('foil')
  })

  it('parse condition entry — condition = LP', () => {
    const result = parseCollectionFile('- Lightning Bolt (LEA:161) [LP]')

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.condition).toBe('LP')
  })

  it('parse full entry — all fields populated', () => {
    const result = parseCollectionFile('- Lightning Bolt (LEA:161) [foil] [LP] {graded}')

    expect(result.entries).toHaveLength(1)
    const entry = result.entries[0]!
    expect(entry.name).toBe('Lightning Bolt')
    expect(entry.set).toBe('LEA')
    expect(entry.collectorNumber).toBe('161')
    expect(entry.finish).toBe('foil')
    expect(entry.condition).toBe('LP')
    expect(entry.note).toBe('graded')
  })

  it('parse multiple entries — all parsed correctly', () => {
    const content = [
      '- Lightning Bolt (LEA:161)',
      '- Dark Ritual (LEA:104)',
      '- Tarmogoyf (FUT:153) [foil]',
    ].join('\n')

    const result = parseCollectionFile(content)

    expect(result.entries).toHaveLength(3)
    expect(result.entries[0]!.name).toBe('Lightning Bolt')
    expect(result.entries[1]!.name).toBe('Dark Ritual')
    expect(result.entries[2]!.name).toBe('Tarmogoyf')
    expect(result.entries[2]!.finish).toBe('foil')
  })

  it('skip non-entry lines — headers, blank lines, comments are skipped', () => {
    const content = [
      '# My Collection',
      '',
      '// a comment line',
      'Some random text',
      '- Lightning Bolt (LEA:161)',
    ].join('\n')

    const result = parseCollectionFile(content)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.name).toBe('Lightning Bolt')
  })

  it('warning for missing set — entry without (SET:CN) generates a warning', () => {
    const result = parseCollectionFile('- Lightning Bolt')

    expect(result.entries).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Lightning Bolt')
  })
})
