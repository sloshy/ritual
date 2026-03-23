import { describe, expect, test } from 'bun:test'
import { parseWantedListFile, formatWantedListLine } from '../../src/commands/wanted-helpers'

describe('parseWantedListFile', () => {
  test('parses name-only entry (state 1)', () => {
    const content = `# My Wanted List\n\n- Lightning Bolt\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Lightning Bolt')
    expect(entries[0]!.set).toBeUndefined()
    expect(entries[0]!.collectorNumber).toBeUndefined()
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.quantity).toBe(1)
  })

  test('parses printing entry without finish (state 2)', () => {
    const content = `- Sol Ring (C19:221)\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.set).toBe('c19')
    expect(entries[0]!.collectorNumber).toBe('221')
    expect(entries[0]!.finish).toBeUndefined()
  })

  test('parses fully specified entry (state 3)', () => {
    const content = `- Arahbo, the First Fang (FDN:2) [foil]\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Arahbo, the First Fang')
    expect(entries[0]!.set).toBe('fdn')
    expect(entries[0]!.collectorNumber).toBe('2')
    expect(entries[0]!.finish).toBe('foil')
  })

  test('parses entry with note', () => {
    const content = `- Mana Crypt (2XM:270) [foil] {Japanese language}\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Mana Crypt')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.note).toBe('Japanese language')
  })

  test('parses name-only entry with note', () => {
    const content = `- Sol Ring {Must be foil}\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.set).toBeUndefined()
    expect(entries[0]!.note).toBe('Must be foil')
  })

  test('does not produce warnings for name-only entries', () => {
    const content = `- Bitterbloom Bearer\n- Lightning Bolt\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.name).toBe('Bitterbloom Bearer')
    expect(entries[1]!.name).toBe('Lightning Bolt')
  })

  test('handles double-faced card names', () => {
    const content = `- Elesh Norn // The Argent Etchings (MOM:12)\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Elesh Norn // The Argent Etchings')
  })

  test('handles collector numbers with special characters', () => {
    const content = `- Serpent of Yawning Depths (SLD:1489★) [foil]\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.collectorNumber).toBe('1489★')
  })

  test('skips non-card lines', () => {
    const content = `# Header\n\nSome text\n- Actual Card\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Actual Card')
  })

  test('parses all three states in one file', () => {
    const content = `# Wishlist\n\n- Lightning Bolt\n- Sol Ring (C19:221)\n- Mana Crypt (2XM:270) [foil]\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(3)

    expect(entries[0]!.set).toBeUndefined()
    expect(entries[0]!.collectorNumber).toBeUndefined()
    expect(entries[0]!.finish).toBeUndefined()

    expect(entries[1]!.set).toBe('c19')
    expect(entries[1]!.collectorNumber).toBe('221')
    expect(entries[1]!.finish).toBeUndefined()

    expect(entries[2]!.set).toBe('2xm')
    expect(entries[2]!.collectorNumber).toBe('270')
    expect(entries[2]!.finish).toBe('foil')
  })

  test('parses etched finish', () => {
    const content = `- Card Name (SET:1) [etched]\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.finish).toBe('etched')
  })

  test('entry without note has undefined note field', () => {
    const content = `- Lightning Bolt\n`
    const { entries } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.note).toBeUndefined()
  })
})

describe('formatWantedListLine', () => {
  test('formats name-only entry', () => {
    const line = formatWantedListLine('Lightning Bolt')
    expect(line).toBe('- Lightning Bolt\n')
  })

  test('formats printing entry without finish', () => {
    const line = formatWantedListLine('Sol Ring', { set: 'c19', collectorNumber: '221' })
    expect(line).toBe('- Sol Ring (C19:221)\n')
  })

  test('formats fully specified entry', () => {
    const line = formatWantedListLine('Mana Crypt', { set: '2xm', collectorNumber: '270' }, 'foil')
    expect(line).toBe('- Mana Crypt (2XM:270) [foil]\n')
  })

  test('omits nonfoil finish tag', () => {
    const line = formatWantedListLine('Sol Ring', { set: 'c19', collectorNumber: '221' }, 'nonfoil')
    expect(line).toBe('- Sol Ring (C19:221)\n')
  })

  test('formats entry with note', () => {
    const line = formatWantedListLine(
      'Mana Crypt',
      { set: '2xm', collectorNumber: '270' },
      'foil',
      'Japanese',
    )
    expect(line).toBe('- Mana Crypt (2XM:270) [foil] {Japanese}\n')
  })

  test('formats name-only entry with note', () => {
    const line = formatWantedListLine('Sol Ring', undefined, undefined, 'Need foil version')
    expect(line).toBe('- Sol Ring {Need foil version}\n')
  })
})
