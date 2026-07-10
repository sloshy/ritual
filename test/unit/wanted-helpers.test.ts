import { describe, test, expect } from 'bun:test'
import { parseWantedListFile, formatWantedListLine } from '../../src/commands/wanted-helpers'

describe('parseWantedListFile', () => {
  test('parses a name-only entry (state 1)', () => {
    const { entries, warnings } = parseWantedListFile('- Lightning Bolt\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Lightning Bolt', quantity: 1 })
    expect(entries[0]!.set).toBeUndefined()
    expect(entries[0]!.collectorNumber).toBeUndefined()
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.note).toBeUndefined()
    expect(entries[0]!.cardId).toBeUndefined()
    expect(warnings).toHaveLength(0)
  })

  test('parses an entry with a specific printing (state 2)', () => {
    const { entries } = parseWantedListFile('- Sol Ring (C19:221)\n')
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', set: 'c19', collectorNumber: '221' })
    expect(entries[0]!.finish).toBeUndefined()
  })

  test('parses a fully specified entry (state 3)', () => {
    const { entries } = parseWantedListFile('- Arahbo, the First Fang (FDN:2) [foil]\n')
    expect(entries[0]).toMatchObject({
      name: 'Arahbo, the First Fang',
      set: 'fdn',
      collectorNumber: '2',
      finish: 'foil',
    })
  })

  test('parses etched finish', () => {
    const { entries } = parseWantedListFile('- Sol Ring (LEA:232) [etched]\n')
    expect(entries[0]).toMatchObject({
      name: 'Sol Ring',
      set: 'lea',
      collectorNumber: '232',
      finish: 'etched',
    })
  })

  test('parses an entry with a note', () => {
    const { entries } = parseWantedListFile('- Mana Crypt (2XM:270) [foil] {Japanese language}\n')
    expect(entries[0]).toMatchObject({
      name: 'Mana Crypt',
      finish: 'foil',
      note: 'Japanese language',
    })
  })

  test('parses a name-only entry with a note', () => {
    const { entries } = parseWantedListFile('- Sol Ring {Must be foil}\n')
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', note: 'Must be foil' })
    expect(entries[0]!.set).toBeUndefined()
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

  test('handles double-faced card names', () => {
    const { entries } = parseWantedListFile('- Elesh Norn // The Argent Etchings (MOM:12)\n')
    expect(entries[0]!.name).toBe('Elesh Norn // The Argent Etchings')
  })

  test('handles collector numbers with special characters', () => {
    const { entries } = parseWantedListFile('- Serpent of Yawning Depths (SLD:1489★) [foil]\n')
    expect(entries[0]!.collectorNumber).toBe('1489★')
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

  test('parses card ID suffix', () => {
    const { entries } = parseWantedListFile('- Sol Ring (C19:221) [foil] &7\n')
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', cardId: 7 })
  })

  test('parses card ID on name-only entry', () => {
    const { entries } = parseWantedListFile('- Lightning Bolt &3\n')
    expect(entries[0]).toMatchObject({ name: 'Lightning Bolt', cardId: 3 })
  })

  test('parses card ID with note', () => {
    const { entries } = parseWantedListFile('- Mana Crypt (2XM:270) [foil] {JP} &12\n')
    expect(entries[0]).toMatchObject({ note: 'JP', cardId: 12 })
  })
})

describe('formatWantedListLine', () => {
  test('formats a name-only entry', () => {
    expect(formatWantedListLine('Lightning Bolt')).toBe('- Lightning Bolt\n')
  })

  test('includes printing when provided', () => {
    expect(formatWantedListLine('Sol Ring', { set: 'LEA', collectorNumber: '232' })).toBe(
      '- Sol Ring (LEA:232)\n',
    )
  })

  test('includes foil finish', () => {
    expect(formatWantedListLine('Sol Ring', undefined, 'foil')).toBe('- Sol Ring [foil]\n')
  })

  test('omits [nonfoil] tag (nonfoil is implicit)', () => {
    expect(formatWantedListLine('Sol Ring', undefined, 'nonfoil')).not.toContain('[nonfoil]')
  })

  test('includes printing and etched finish', () => {
    expect(formatWantedListLine('Sol Ring', { set: 'CMR', collectorNumber: '1' }, 'etched')).toBe(
      '- Sol Ring (CMR:1) [etched]\n',
    )
  })

  test('includes a note', () => {
    expect(formatWantedListLine('Sol Ring', undefined, undefined, 'signed')).toBe(
      '- Sol Ring {signed}\n',
    )
  })

  test('formats entry with card ID', () => {
    expect(
      formatWantedListLine(
        'Sol Ring',
        { set: 'c19', collectorNumber: '221' },
        'foil',
        undefined,
        5,
      ),
    ).toBe('- Sol Ring (C19:221) [foil] &5\n')
  })

  test('formats name-only entry with card ID', () => {
    expect(formatWantedListLine('Lightning Bolt', undefined, undefined, undefined, 3)).toBe(
      '- Lightning Bolt &3\n',
    )
  })

  test('formats entry with note and card ID', () => {
    expect(
      formatWantedListLine(
        'Sol Ring',
        { set: 'c19', collectorNumber: '221' },
        undefined,
        'for EDH',
        10,
      ),
    ).toBe('- Sol Ring (C19:221) {for EDH} &10\n')
  })
})
