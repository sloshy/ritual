import { describe, test, expect } from 'bun:test'
import {
  parseWantedListFile,
  formatWantedListLine,
  WANTED_CARD_LINE_RE,
} from '../../src/list/wanted-file'

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

  test('skips non-list lines, warning on each so no gate misses them', () => {
    const content = '# My Wanted List\n\nSome text\n- Lightning Bolt\n'
    const { entries, warnings } = parseWantedListFile(content)
    expect(entries).toHaveLength(1)
    expect(warnings).toEqual(['Skipped malformed line: Some text'])
  })

  test('warns on nearly-empty list lines (no content after "- ")', () => {
    // '- \n' trims to '-', which does not start with '- ' — a re-serializing
    // save would delete it, so it must be reported like any unreadable line.
    const { entries, warnings } = parseWantedListFile('- \n')
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual(['Skipped malformed line: -'])
  })

  test('warns on prose and other non-bullet lines, but not the title or blanks', () => {
    const { entries, warnings } = parseWantedListFile(
      '# Wants\n\n// sort these later\nsome prose\n### deep heading\n- Sol Ring &1\n',
    )
    expect(entries).toHaveLength(1)
    expect(warnings).toEqual([
      'Skipped malformed line: // sort these later',
      'Skipped malformed line: some prose',
      'Skipped malformed line: ### deep heading',
    ])
  })

  test('warns on a second H1 — only the first is the title', () => {
    const { warnings } = parseWantedListFile('# Wants\n\n- Sol Ring &1\n# Another Title\n')
    expect(warnings).toEqual(['Skipped malformed line: # Another Title'])
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
    expect(formatWantedListLine({ name: 'Lightning Bolt' })).toBe('- Lightning Bolt\n')
  })

  test('includes printing when provided', () => {
    expect(
      formatWantedListLine({ name: 'Sol Ring', printing: { set: 'LEA', collectorNumber: '232' } }),
    ).toBe('- Sol Ring (LEA:232)\n')
  })

  test('includes foil finish', () => {
    expect(formatWantedListLine({ name: 'Sol Ring', finish: 'foil' })).toBe('- Sol Ring [foil]\n')
  })

  test('omits [nonfoil] tag (nonfoil is implicit)', () => {
    expect(formatWantedListLine({ name: 'Sol Ring', finish: 'nonfoil' })).not.toContain('[nonfoil]')
  })

  test('includes printing and etched finish', () => {
    expect(
      formatWantedListLine({
        name: 'Sol Ring',
        printing: { set: 'CMR', collectorNumber: '1' },
        finish: 'etched',
      }),
    ).toBe('- Sol Ring (CMR:1) [etched]\n')
  })

  test('includes a note', () => {
    expect(formatWantedListLine({ name: 'Sol Ring', note: 'signed' })).toBe('- Sol Ring {signed}\n')
  })

  test('formats entry with card ID', () => {
    expect(
      formatWantedListLine({
        name: 'Sol Ring',
        printing: { set: 'c19', collectorNumber: '221' },
        finish: 'foil',
        cardId: 5,
      }),
    ).toBe('- Sol Ring (C19:221) [foil] &5\n')
  })

  test('formats name-only entry with card ID', () => {
    expect(formatWantedListLine({ name: 'Lightning Bolt', cardId: 3 })).toBe(
      '- Lightning Bolt &3\n',
    )
  })

  test('formats entry with note and card ID', () => {
    expect(
      formatWantedListLine({
        name: 'Sol Ring',
        printing: { set: 'c19', collectorNumber: '221' },
        note: 'for EDH',
        cardId: 10,
      }),
    ).toBe('- Sol Ring (C19:221) {for EDH} &10\n')
  })
})

describe('parseWantedListFile — fenced code blocks', () => {
  test('fenced bullets and headers are prose: no entries, no warnings', () => {
    const content = [
      '# Needs',
      '',
      '## Main',
      '- Sol Ring &1',
      '',
      '```md',
      '## Fake Section',
      '- Black Lotus (LEA:232) &99',
      'plain prose',
      '```',
      '',
      '- Mana Crypt (2XM:270) &2',
      '',
    ].join('\n')
    const { entries, warnings, sectionOrder, fencedLines } = parseWantedListFile(content)
    expect(warnings).toEqual([])
    expect(fencedLines).toBe(5)
    expect(sectionOrder).toEqual(['Main'])
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring', 'Mana Crypt'])
  })

  test('an unclosed fence hides the rest of the file', () => {
    // The wanted parser accepts a bare name as an entry, so an unclosed fence
    // here is the case most likely to turn prose into card entries.
    const { entries, warnings } = parseWantedListFile(
      ['- Sol Ring &1', '~~~', '- Black Lotus (LEA:232) &2', 'just some prose'].join('\n'),
    )
    expect(warnings).toEqual([])
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring'])
  })
})

describe('parseWantedListFile — deck-style quantity prefixes', () => {
  // Wanted lists hold one line per copy exactly like collections, so the same
  // trap gets the same advisory (and, like there, never blocks a save).
  test('advises on a leading quantity, without dropping the line', () => {
    const { entries, warnings, advisories } = parseWantedListFile('- 2 Sol Ring (C21:240)\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('2 Sol Ring')
    expect(warnings).toHaveLength(0)
    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toContain('one line per copy')
  })

  test('leaves a card name that legitimately starts with a year alone', () => {
    const { advisories } = parseWantedListFile('- 1996 World Champion (PCEL:1)\n')
    expect(advisories).toEqual([])
  })
})

describe('parseWantedListFile — front matter', () => {
  test('skips and captures a block without warnings or interpretation', () => {
    const content = '---\nlabels: [sale]\nowner: me\n---\n\n# Wants\n\n- Mana Crypt &1\n'
    const parsed = parseWantedListFile(content)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.warnings).toHaveLength(0)
    expect(parsed.frontMatter?.raw).toBe('---\nlabels: [sale]\nowner: me\n---\n')
    // Wanted lists define no front-matter keys — the block is carried, never read.
    expect('labels' in parsed).toBe(false)
  })
})

describe('parseWantedListFile — language token', () => {
  test('reads a [ja] token after the finish', () => {
    const { entries, warnings } = parseWantedListFile(`- Sol Ring (LTC:284) [foil] [ja]\n`)
    expect(warnings).toHaveLength(0)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.language).toBe('ja')
  })

  test('reads a language token with note and id, no finish', () => {
    const { entries } = parseWantedListFile(`- Sol Ring (LTC:284) [zht] {trade fodder} &4\n`)
    expect(entries[0]!.language).toBe('zht')
    expect(entries[0]!.note).toBe('trade fodder')
    expect(entries[0]!.cardId).toBe(4)
  })

  test('reads a language token on a name-only entry', () => {
    const { entries } = parseWantedListFile(`- Sol Ring [ja]\n`)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.set).toBeUndefined()
    expect(entries[0]!.language).toBe('ja')
  })

  test('a bare line has no language — en is never synthesized', () => {
    const { entries } = parseWantedListFile(`- Sol Ring (C19:221) [etched] {note} &9\n`)
    expect(entries[0]!.language).toBeUndefined()
    expect(entries[0]!.note).toBe('note')
    expect(entries[0]!.cardId).toBe(9)
  })

  test('the &N id stays the final capture group with a language present', () => {
    const match = '- Sol Ring (LTC:284) [foil] [ja] {x} &12'.match(WANTED_CARD_LINE_RE)!
    expect(match[match.length - 1]).toBe('12')
  })

  test('an explicit [en] token is read as en, not folded to undefined', () => {
    // The serializer never writes [en], but a hand-written token must still
    // parse: absent-vs-en is a write-side fold, not a read-side one.
    const { entries, warnings } = parseWantedListFile(`- Sol Ring (C19:221) [en]\n`)
    expect(warnings).toHaveLength(0)
    expect(entries[0]!.language).toBe('en')
  })

  test('[jp] is not a language: a bullet line swallows it into the name (no warning)', () => {
    // Documented limitation, unlike the collection/deck parsers: every field
    // after the name is optional here, so `- Name … [jp]` always matches with
    // the unknown token inside the name and never reaches the malformed-line
    // branch (whose did-you-mean hint is therefore unreachable from a bullet
    // line). If this ever warns instead, that is an improvement — update this
    // pin, not the parser back.
    const { entries, warnings } = parseWantedListFile(`- Mana Crypt (2XM:270) [jp]\n`)
    expect(warnings).toHaveLength(0)
    expect(entries[0]!.name).toBe('Mana Crypt (2XM:270) [jp]')
    expect(entries[0]!.language).toBeUndefined()
  })

  test('a non-bullet line with a misspelled token is skipped with a warning', () => {
    // The closest a wanted list gets to the deck/collection rejection: the
    // line is reported (though this branch does not carry the hint).
    const { entries, warnings } = parseWantedListFile(`Mana Crypt [jp]\n`)
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual(['Skipped malformed line: Mana Crypt [jp]'])
  })
})

describe('formatWantedListLine — language token', () => {
  test('writes the token after the finish and never writes en', () => {
    expect(
      formatWantedListLine({
        name: 'Sol Ring',
        printing: { set: 'ltc', collectorNumber: '284' },
        finish: 'foil',
        language: 'ja',
      }),
    ).toBe('- Sol Ring (LTC:284) [foil] [ja]\n')
    expect(
      formatWantedListLine({
        name: 'Sol Ring',
        printing: { set: 'ltc', collectorNumber: '284' },
        finish: 'foil',
        language: 'en',
      }),
    ).toBe('- Sol Ring (LTC:284) [foil]\n')
  })

  test('round-trips a [ja] line with note and id through the parser', () => {
    const line = formatWantedListLine({
      name: 'Sol Ring',
      printing: { set: 'ltc', collectorNumber: '284' },
      language: 'ja',
      note: 'gift',
      cardId: 12,
    })
    expect(line).toBe('- Sol Ring (LTC:284) [ja] {gift} &12\n')
    const { entries, warnings } = parseWantedListFile(line)
    expect(warnings).toHaveLength(0)
    expect(entries[0]!.language).toBe('ja')
    expect(entries[0]!.note).toBe('gift')
    expect(entries[0]!.cardId).toBe(12)
  })
})
