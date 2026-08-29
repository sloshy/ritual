import { describe, test, expect } from 'bun:test'
import {
  ensureDeckIdsInContent,
  ensureCollectionIdsInContent,
  ensureWantedIdsInContent,
} from '../../src/list/ensure-card-ids'

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

describe('flat-list front matter', () => {
  test('collection: never stamps an id into a YAML value that looks like a card line', () => {
    const input = [
      '---',
      'note: - Sol Ring (C21:263)',
      'labels: [sale]',
      '---',
      '',
      '# Binder',
      '- Lightning Bolt (LEA:161)',
      '',
    ].join('\n')
    const { content, added } = ensureCollectionIdsInContent(input)
    expect(added).toBe(1)
    expect(content).toContain('note: - Sol Ring (C21:263)\n')
    expect(content).toContain('- Lightning Bolt (LEA:161) &1')
  })

  test('collection: a labeled line gains its id after the labels token', () => {
    const { content } = ensureCollectionIdsInContent('- Sol Ring (C21:263) [sale,trade]\n')
    expect(content).toBe('- Sol Ring (C21:263) [sale,trade] &1\n')
  })

  test('wanted: front matter is skipped too', () => {
    const input = ['---', 'x: - Mana Crypt', '---', '- Mana Crypt', ''].join('\n')
    const { content, added } = ensureWantedIdsInContent(input)
    expect(added).toBe(1)
    expect(content).toContain('x: - Mana Crypt\n')
    expect(content).toContain('- Mana Crypt &1')
  })
})

/**
 * A collection and a wanted list hold one line per physical copy, so a pasted
 * quantity is *accepted* on read and expanded on the next save. The expansion
 * allocates from the file's own id pool and never renumbers an id that is
 * already on a line — a moved `&N` would take custom art and undo history with
 * it.
 */
describe('flat-list quantity expansion', () => {
  test('a collection line becomes one line per copy, keeping its own id first', () => {
    const { content, added } = ensureCollectionIdsInContent(
      '# Binder\n\n- 3 Sol Ring (C21:240) [foil] &4\n',
    )
    expect(added).toBe(2)
    expect(content).toBe(
      [
        '# Binder',
        '',
        '- Sol Ring (C21:240) [foil] &4',
        '- Sol Ring (C21:240) [foil] &1',
        '- Sol Ring (C21:240) [foil] &2',
        '',
      ].join('\n'),
    )
  })

  test('the expansion writes every token the line carried', () => {
    const { content } = ensureCollectionIdsInContent(
      '- 2 Sol Ring (C21:240) [foil] [LP] [ja] [keep] {mine}\n',
    )
    expect(content.split('\n').slice(0, 2)).toEqual([
      '- Sol Ring (C21:240) [foil] [LP] [ja] [keep] {mine} &1',
      '- Sol Ring (C21:240) [foil] [LP] [ja] [keep] {mine} &2',
    ])
  })

  test('extra copies take pool ids without disturbing the ids already in the file', () => {
    const { content, added } = ensureCollectionIdsInContent(
      ['- Mox Pearl (LEA:265) &1', '- 2 Sol Ring (C21:240) &3', '- Black Lotus (LEA:232) &4'].join(
        '\n',
      ),
    )
    expect(added).toBe(1)
    expect(content.split('\n')).toEqual([
      '- Mox Pearl (LEA:265) &1',
      '- Sol Ring (C21:240) &3',
      // The gap the pool held (&2), not a renumbering of &3 or &4.
      '- Sol Ring (C21:240) &2',
      '- Black Lotus (LEA:232) &4',
    ])
  })

  test('an expanded line claims its own id before a duplicate is reassigned', () => {
    // Two rules meeting on one file: the first copy keeps `&1`, so the *later*
    // line that also says `&1` is the duplicate — dropping the expansion's
    // claim would leave two lines carrying one id.
    const { content, added } = ensureCollectionIdsInContent(
      '- 2 Sol Ring (C21:240) &1\n- Mox Pearl (LEA:265) &1\n',
    )
    expect(added).toBe(2)
    expect(content).toBe(
      '- Sol Ring (C21:240) &1\n- Sol Ring (C21:240) &2\n- Mox Pearl (LEA:265) &3\n',
    )
  })

  test('a second save is a no-op: the ids the first one handed out stay put', () => {
    const first = ensureWantedIdsInContent('# Wants\n\n- 2 Sol Ring\n- Brainstorm &5\n')
    expect(first.added).toBe(2)
    const second = ensureWantedIdsInContent(first.content)
    expect(second.added).toBe(0)
    expect(second.content).toBe(first.content)
    expect(first.content).toContain('- Sol Ring &1\n- Sol Ring &2\n')
  })

  test('a deck line keeps its quantity — copies live on the line there', () => {
    const { content, added } = ensureDeckIdsInContent('## Main\n4 Lightning Bolt (LEA:161)\n')
    expect(added).toBe(1)
    expect(content).toBe('## Main\n4 Lightning Bolt (LEA:161) &1\n')
  })

  test('a line whose labels token the grammar refuses is stamped but never expanded', () => {
    // Rewriting the line would delete the token the user has to see to fix.
    const { content, added } = ensureCollectionIdsInContent('- 2 Sol Ring (C21:240) [sale,keep]\n')
    expect(added).toBe(1)
    expect(content).toBe('- 2 Sol Ring (C21:240) [sale,keep] &1\n')
  })

  test('a fenced quantity line is prose: neither stamped nor expanded', () => {
    const input = ['```', '- 2 Sol Ring (C21:240)', '```', '- Mox Pearl (LEA:265)'].join('\n')
    const { content, added } = ensureCollectionIdsInContent(input)
    expect(added).toBe(1)
    expect(content.split('\n')).toEqual([
      '```',
      '- 2 Sol Ring (C21:240)',
      '```',
      '- Mox Pearl (LEA:265) &1',
    ])
  })
})
