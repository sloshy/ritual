import { describe, expect, test } from 'bun:test'
import { parseCollectionFile, resolveFinish, type CollectionEntry } from '../../src/collection-file'
import { makeScryfallCard } from '../test-utils'

describe('parseCollectionFile', () => {
  test('parses card with set and collector number', () => {
    const content = `# My Collection\n\n- Arcane Signet (ECC:55)\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Arcane Signet')
    expect(entries[0]!.set).toBe('ecc')
    expect(entries[0]!.collectorNumber).toBe('55')
    expect(entries[0]!.quantity).toBe(1)
    expect(entries[0]!.note).toBeUndefined()
    expect(entries[0]!.cardId).toBeUndefined()
    expect(warnings).toHaveLength(0)
  })

  test('warns and skips cards missing set code', () => {
    const content = `- Bitterbloom Bearer\n- Jeska's Will (CLB:799)\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe("Jeska's Will")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Bitterbloom Bearer')
    expect(warnings[0]).toContain('missing set code')
  })

  test('parses card with finish and condition', () => {
    const content = `- Arahbo, the First Fang (FDN:2) [foil] [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Arahbo, the First Fang')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
  })

  test('parses condition without finish', () => {
    const content = `- Adeline, Resplendent Cathar (MID:1) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Adeline, Resplendent Cathar')
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.condition).toBe('NM')
  })

  test('does not aggregate duplicates — each line is a separate entry', () => {
    const content = `- Sol Ring (C19:221)\n- Sol Ring (MH3:300)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.set).toBe('c19')
    expect(entries[1]!.set).toBe('mh3')
  })

  test('handles double-faced card names', () => {
    const content = `- Elesh Norn // The Argent Etchings (MOM:12) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Elesh Norn // The Argent Etchings')
  })

  test('skips non-card lines, warning on each so no gate misses them', () => {
    const content = `# Header\n\nSome text\n- Actual Card (SET:1)\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Actual Card')
    expect(warnings).toEqual(['Skipped malformed line: Some text'])
  })

  test('warns on prose, comments, and deep headings, but not the title or blanks', () => {
    const content = `# Binder\n\n// sort these later\n### deep heading\n## Page 1\n- Opt (XLN:65) &1\n`
    const { entries, warnings, sectionOrder } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(sectionOrder).toEqual(['Page 1'])
    expect(warnings).toEqual([
      'Skipped malformed line: // sort these later',
      'Skipped malformed line: ### deep heading',
    ])
  })

  test('warns on a second H1 — only the first is the title', () => {
    const { warnings } = parseCollectionFile('# Binder\n\n- Opt (XLN:65) &1\n# Another\n')
    expect(warnings).toEqual(['Skipped malformed line: # Another'])
  })

  test('handles collector numbers with letters', () => {
    const content = `- Nomad Mythmaker (PLST:10E-30) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.collectorNumber).toBe('10E-30')
  })

  test('handles collector numbers with special characters', () => {
    const content = `- Serpent of Yawning Depths (SLD:1489★) [foil] [NM]\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Serpent of Yawning Depths')
    expect(entries[0]!.set).toBe('sld')
    expect(entries[0]!.collectorNumber).toBe('1489★')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
    expect(warnings).toHaveLength(0)
  })

  test('parses card with note', () => {
    const content = `- Mana Crypt (2XM:270) [foil] [NM] {Japanese language, ignore pricing}\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Mana Crypt')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
    expect(entries[0]!.note).toBe('Japanese language, ignore pricing')
  })

  test('parses card with note but no finish or condition', () => {
    const content = `- Sol Ring (C19:221) {Signed by artist}\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.condition).toBeUndefined()
    expect(entries[0]!.note).toBe('Signed by artist')
  })

  test('parses card ID suffix', () => {
    const content = `- Sol Ring (C19:221) [foil] [NM] &5\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.cardId).toBe(5)
  })

  test('parses card ID with note', () => {
    const content = `- Mana Crypt (2XM:270) [foil] [NM] {JP} &12\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.note).toBe('JP')
    expect(entries[0]!.cardId).toBe(12)
  })

  test('parses card ID without finish or condition', () => {
    const content = `- Arcane Signet (ECC:55) &1\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.cardId).toBe(1)
  })
})

function makeEntry(overrides: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    name: 'Test Card',
    quantity: 1,
    set: 'FDN',
    collectorNumber: '1',
    section: 'Main',
    ...overrides,
  }
}

describe('resolveFinish', () => {
  test('uses entry finish if specified', () => {
    expect(resolveFinish(makeEntry({ finish: 'foil' }), makeScryfallCard())).toBe('foil')
  })

  test('defaults to nonfoil if card supports it', () => {
    expect(resolveFinish(makeEntry(), makeScryfallCard({ finishes: ['nonfoil', 'foil'] }))).toBe(
      'nonfoil',
    )
  })

  test('defaults to first finish if nonfoil not available', () => {
    expect(resolveFinish(makeEntry(), makeScryfallCard({ finishes: ['foil'] }))).toBe('foil')
  })
})

describe('parseCollectionFile — fenced code blocks', () => {
  test('fenced bullets and headers are prose: no entries, no warnings', () => {
    const content = [
      '# My Collection',
      '',
      '## Main',
      '- Sol Ring (C21:263) &1',
      '',
      '```',
      '## Fake Section',
      '- Black Lotus (LEA:232) &99',
      'plain prose that is not a bullet',
      '```',
      '',
      '- Mana Crypt (2XM:270) &2',
      '',
    ].join('\n')
    const { entries, warnings, sectionOrder, fencedLines } = parseCollectionFile(content)
    expect(warnings).toEqual([])
    expect(fencedLines).toBe(5)
    expect(sectionOrder).toEqual(['Main'])
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring', 'Mana Crypt'])
  })

  test('an unclosed fence hides the rest of the file', () => {
    const { entries, warnings } = parseCollectionFile(
      ['- Sol Ring (C21:263) &1', '~~~', '- Black Lotus (LEA:232) &2'].join('\n'),
    )
    expect(warnings).toEqual([])
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring'])
  })
})
