import { describe, test, expect } from 'bun:test'
import { parseWantedListFile, formatWantedListLine } from '../../src/list/wanted-file'

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

  test('warns on prose and deep headings, but not the title, comments, or blanks', () => {
    const { entries, warnings } = parseWantedListFile(
      '# Wants\n\n// sort these later\nsome prose\n### deep heading\n- Sol Ring &1\n',
    )
    expect(entries).toHaveLength(1)
    // A `//` comment is a recognized line kind — read, then dropped on write.
    expect(warnings).toEqual([
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

describe('parseWantedListFile — quantity expansion', () => {
  // Wanted lists hold one line per copy exactly like collections, so a pasted
  // quantity is read as that many entries and advised about (never a warning:
  // nothing is lost, and the save rewrites the line as N lines).
  test('a quantity yields one entry per copy, with an advisory', () => {
    const { entries, warnings, advisories, diagnostics } = parseWantedListFile(
      '- 2 Sol Ring (C21:240) &3\n',
    )
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring', 'Sol Ring'])
    // Only the first copy holds the line's id; the rest get one at save time.
    expect(entries.map((e) => e.cardId)).toEqual([3, undefined])
    expect(warnings).toHaveLength(0)
    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toContain('Read 2 copies')
    expect(diagnostics).toMatchObject([{ severity: 'advisory', kind: 'quantity-expanded' }])
  })

  test('leaves a card name that legitimately starts with a year alone', () => {
    const { entries, advisories } = parseWantedListFile('- 1996 World Champion (PCEL:1)\n')
    expect(entries[0]!.name).toBe('1996 World Champion')
    expect(advisories).toEqual([])
  })
})

/**
 * Owner decision §0(5): a wanted list never carries a condition. The refusal
 * has to *say* that — the old grammar swallowed the whole line and blamed a
 * missing set code three tokens away.
 */
describe('parseWantedListFile — tokens a wanted list does not carry', () => {
  test('a condition names the token and the rule', () => {
    const { entries, warnings, diagnostics } = parseWantedListFile('- Bolt (LEA:161) [LP]\n')
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual([
      'line 1: [LP] is not a wanted list token — wanted lists never carry a condition.',
    ])
    expect(diagnostics).toMatchObject([
      { code: 'token-not-allowed', kind: 'condition', token: '[LP]' },
    ])
  })

  test('a labels token names the token and the rule', () => {
    const { entries, warnings } = parseWantedListFile('- Bolt (LEA:161) [keep]\n')
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual([
      'line 1: [keep] is not a wanted list token — wanted lists never carry labels.',
    ])
  })
})

/**
 * The tokenizer reads a bare name as a name-only card line — which a wanted
 * list legitimately holds — so the `- ` bullet is the only thing keeping a
 * list's prose out of the entries.
 */
describe('parseWantedListFile — prose is never a card', () => {
  test('commentary between entries warns instead of becoming a card', () => {
    const { entries, warnings } = parseWantedListFile(
      '# Wants\n\nAsk about these at the next event\n- Sol Ring &1\n',
    )
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring'])
    expect(warnings).toEqual(['Skipped malformed line: Ask about these at the next event'])
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

  test('every token of a full line is read, whatever order they arrive in', () => {
    const { entries, warnings } = parseWantedListFile('- Sol Ring (LTC:284) [ja] {x} [foil] &12\n')
    expect(warnings).toHaveLength(0)
    expect(entries[0]).toMatchObject({
      name: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      language: 'ja',
      note: 'x',
      cardId: 12,
    })
  })

  test('an explicit [en] token folds to no language at all', () => {
    // A bare line means English and the serializers never write `[en]`, so
    // storing `en` would give one state two spellings.
    const { entries, warnings } = parseWantedListFile(`- Sol Ring (C19:221) [en]\n`)
    expect(warnings).toHaveLength(0)
    expect(entries[0]!.language).toBeUndefined()
  })

  test('[jp] is not a language: the bullet line is refused, naming the token', () => {
    // The old wanted grammar swallowed it into the name with no warning at
    // all; every bracket token is now classified, so a misspelling is named.
    const { entries, warnings } = parseWantedListFile(`- Mana Crypt (2XM:270) [jp]\n`)
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual(['line 1: Unrecognized token [jp]. (did you mean [ja]?)'])
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
