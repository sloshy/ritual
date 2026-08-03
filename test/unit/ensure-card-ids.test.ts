import { describe, test, expect } from 'bun:test'
import {
  ensureDeckIdsInContent,
  ensureCollectionIdsInContent,
  ensureWantedIdsInContent,
} from '../../src/ensure-card-ids'

describe('ensureDeckIdsInContent', () => {
  test('appends &N to card lines that lack one, leaving lines with IDs alone', () => {
    const input = [
      '---',
      'name: Test Deck',
      '---',
      '',
      '## Main',
      '4 Lightning Bolt (LEA:161)',
      '1 Sol Ring &7',
      '2 Brainstorm [foil]',
    ].join('\n')

    const { content, added } = ensureDeckIdsInContent(input)
    expect(added).toBe(2)
    const lines = content.split('\n')
    expect(lines).toContain('4 Lightning Bolt (LEA:161) &1')
    expect(lines).toContain('1 Sol Ring &7')
    expect(lines).toContain('2 Brainstorm [foil] &2')
  })

  test('seeds new IDs from existing pool, filling gaps before going sequential', () => {
    const input = ['## Main', '1 Card A &1', '1 Card B &3', '1 Card C', '1 Card D'].join('\n')
    const { content, added } = ensureDeckIdsInContent(input)
    expect(added).toBe(2)
    expect(content).toContain('1 Card C &2')
    expect(content).toContain('1 Card D &4')
  })

  test('does not touch front matter that happens to contain digits', () => {
    const input = ['---', 'count: 4 things', '---', '## Main', '1 Sol Ring'].join('\n')
    const { content } = ensureDeckIdsInContent(input)
    expect(content).toContain('count: 4 things')
    expect(content).not.toContain('count: 4 things &')
  })

  test('returns content unchanged when every card line already has an ID', () => {
    const input = ['## Main', '4 Sol Ring &1', '1 Brainstorm &2'].join('\n')
    const { content, added } = ensureDeckIdsInContent(input)
    expect(added).toBe(0)
    expect(content).toBe(input)
  })

  test('reassigns duplicate IDs, keeping the first occurrence and filling gaps', () => {
    // &2 appears twice; second occurrence should get the next available slot (&3)
    const input = ['## Main', '1 Card A &1', '1 Card B &2', '1 Card C &2'].join('\n')
    const { content, added } = ensureDeckIdsInContent(input)
    expect(added).toBe(1)
    const lines = content.split('\n')
    expect(lines).toContain('1 Card A &1')
    expect(lines).toContain('1 Card B &2')
    expect(lines).toContain('1 Card C &3')
  })
})

describe('ensureCollectionIdsInContent', () => {
  test('appends IDs to list items, preserving notes and conditions', () => {
    const input = [
      '# My Collection',
      '',
      '- Lightning Bolt (LEA:161) [NM]',
      '- Sol Ring (CMR:329) [foil] [NM] {birthday gift}',
      '- Brainstorm (ICE:61) &5',
    ].join('\n')

    const { content, added } = ensureCollectionIdsInContent(input)
    expect(added).toBe(2)
    expect(content).toContain('- Lightning Bolt (LEA:161) [NM] &1')
    expect(content).toContain('- Sol Ring (CMR:329) [foil] [NM] {birthday gift} &2')
    expect(content).toContain('- Brainstorm (ICE:61) &5')
  })
})

describe('ensureWantedIdsInContent', () => {
  test('appends IDs to wanted list items including name-only entries', () => {
    const input = [
      '# Want',
      '- Sol Ring',
      '- Lightning Bolt (LEA:161) [foil] {must be english}',
      '- Counterspell &10',
    ].join('\n')

    const { content, added } = ensureWantedIdsInContent(input)
    expect(added).toBe(2)
    expect(content).toContain('- Sol Ring &1')
    expect(content).toContain('- Lightning Bolt (LEA:161) [foil] {must be english} &2')
    expect(content).toContain('- Counterspell &10')
  })

  test('assigns IDs to every bare-name list item, even non-card prose', () => {
    const input = ['# Want', '- See related: my other list', '- Sol Ring'].join('\n')
    const { content } = ensureWantedIdsInContent(input)
    // Both lines look like list items, but the first has no card-printing-style structure.
    // Wanted list regex accepts a bare name, so both will get IDs — that's expected behavior.
    expect(content).toContain('- See related: my other list &1')
    expect(content).toContain('- Sol Ring &2')
  })
})

describe('fenced code blocks', () => {
  test('deck backfill leaves fenced card lines un-stamped', () => {
    const input = [
      '---',
      'name: Fenced Deck',
      '---',
      '',
      '## Main',
      '1 Sol Ring',
      '```',
      '1 Black Lotus',
      '```',
      '',
    ].join('\n')
    const { content, added } = ensureDeckIdsInContent(input)
    expect(added).toBe(1)
    expect(content.split('\n')).toContain('1 Sol Ring &1')
    expect(content.split('\n')).toContain('1 Black Lotus')
  })

  test('a fenced &N neither blocks nor seeds an allocation', () => {
    const input = ['## Main', '```', '- Example (LEA:1) &7', '```', '- Sol Ring (C21:263)'].join(
      '\n',
    )
    const { content, added } = ensureCollectionIdsInContent(input)
    expect(added).toBe(1)
    expect(content.split('\n')).toContain('- Sol Ring (C21:263) &1')
    expect(content.split('\n')).toContain('- Example (LEA:1) &7')
  })

  test('wanted backfill leaves fenced lines alone', () => {
    const input = ['~~~', '- Example &4', '~~~', '- Sol Ring'].join('\n')
    const { content, added } = ensureWantedIdsInContent(input)
    expect(added).toBe(1)
    expect(content.split('\n')).toEqual(['~~~', '- Example &4', '~~~', '- Sol Ring &1'])
  })
})
