import { describe, expect, test } from 'bun:test'
import { parseCollectionFile } from '../../src/list/collection-file'

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

  test('warns and skips cards that name no printing', () => {
    const content = `- Bitterbloom Bearer\n- Jeska's Will (CLB:799)\n`
    const { entries, warnings, diagnostics } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe("Jeska's Will")
    expect(warnings).toEqual([
      'line 1: A collection line must name a printing, e.g. (LEA:161): - Bitterbloom Bearer',
    ])
    expect(diagnostics).toMatchObject([{ code: 'missing-printing', kind: 'printing' }])
  })

  test('the file name prefixes every diagnostic when the caller knows it', () => {
    const { warnings } = parseCollectionFile('# Binder\n\n- Bitterbloom Bearer\n', {
      file: 'collections/binder.md',
    })
    expect(warnings[0]).toStartWith('collections/binder.md:3: ')
  })

  test('a misspelled language token names the token and its fix', () => {
    const { entries, warnings, diagnostics } = parseCollectionFile('- Shock (M21:159) [JA]\n')
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual(['line 1: Unrecognized token [JA]. (did you mean [ja]?)'])
    expect(diagnostics).toMatchObject([{ code: 'unknown-token', token: '[JA]' }])
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

  test('warns on prose and deep headings, but not the title, comments, or blanks', () => {
    const content = `# Binder\n\n// sort these later\n### deep heading\n## Page 1\n- Opt (XLN:65) &1\n`
    const { entries, warnings, sectionOrder } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(sectionOrder).toEqual(['Page 1'])
    // A `//` comment is a recognized line kind — read, then dropped on write.
    expect(warnings).toEqual(['Skipped malformed line: ### deep heading'])
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

/**
 * Collections and wanted lists hold one line per copy, so a quantity on a
 * bullet is *accepted and expanded*: the parse reads that many entries and says
 * so with an advisory. An advisory rather than a warning because nothing is
 * lost — the save rewrites the line as N lines (see `ensure-card-ids.ts`) — so
 * it must not trip the whole-file-rewrite gates.
 */
describe('parseCollectionFile — quantity expansion', () => {
  test('a quantity yields one entry per copy, with an advisory', () => {
    const { entries, warnings, advisories, diagnostics } = parseCollectionFile(
      '- 3 Sol Ring (C21:240) [foil] &4\n',
    )
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring', 'Sol Ring', 'Sol Ring'])
    expect(entries.every((e) => e.quantity === 1 && e.finish === 'foil')).toBe(true)
    // Only the first copy holds the line's id: the others have none until a
    // save allocates them one, and duplicating it would make two entries claim
    // the same `&N`.
    expect(entries.map((e) => e.cardId)).toEqual([4, undefined, undefined])
    expect(warnings).toHaveLength(0)
    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toContain('Read 3 copies')
    expect(diagnostics).toMatchObject([{ severity: 'advisory', kind: 'quantity-expanded' }])
  })

  test('a quantity of one is silent and yields one entry', () => {
    const { entries, advisories } = parseCollectionFile('- 1 Sol Ring (C21:240)\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(advisories).toEqual([])
  })

  test('a card name that legitimately starts with a year is left alone', () => {
    // `1996 World Champion` is a real card: only a 1-3 digit leading integer
    // reads as a quantity, so four digits parse untouched and unremarked.
    const { entries, advisories } = parseCollectionFile('- 1996 World Champion (PCEL:1)\n')
    expect(entries[0]!.name).toBe('1996 World Champion')
    expect(advisories).toEqual([])
  })

  test('a line whose whole name was a quantity is refused, never guessed at', () => {
    // `- 60 (UNF:1)` reads as sixty copies of a card with no name. Nothing here
    // is silent: the line warns and the gates block until it is fixed.
    const { entries, warnings } = parseCollectionFile('- 60 (UNF:1)\n')
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual(['line 1: No card name: - 60 (UNF:1)'])
  })
})

describe('parseCollectionFile — labels token', () => {
  test('parses a single label between condition and note', () => {
    const { entries, warnings } = parseCollectionFile(
      '- Lightning Bolt (LEA:161) [foil] [LP] [keep] {my first rare} &1\n',
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]!.labels).toEqual(['keep'])
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('LP')
    expect(entries[0]!.note).toBe('my first rare')
    expect(entries[0]!.cardId).toBe(1)
    expect(warnings).toHaveLength(0)
  })

  test('parses a combined token and normalizes its order', () => {
    const { entries } = parseCollectionFile('- Sol Ring (C21:263) [trade,sale] &2\n')
    expect(entries[0]!.labels).toEqual(['sale', 'trade'])
  })

  test('parses the token with no other annotations', () => {
    const { entries } = parseCollectionFile('- Sol Ring (C21:263) [sale]\n')
    expect(entries[0]!.labels).toEqual(['sale'])
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.condition).toBeUndefined()
  })

  test('keep-conflict refuses the line and names both labels', () => {
    // A self-conflicting token is a grammar refusal, not a value one: the line
    // is skipped and warns, so the rewrite gates block until it is fixed.
    const { entries, warnings, diagnostics } = parseCollectionFile(
      '- Sol Ring (C21:263) [sale,keep] &2\n',
    )
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual([
      'line 1: Conflicting labels [sale,keep] — [keep] cannot be combined with any other label.',
    ])
    expect(diagnostics).toMatchObject([{ code: 'conflicting-labels', token: '[sale,keep]' }])
  })

  test('an uppercase token is not a labels token — the line warns, naming it', () => {
    const { entries, warnings } = parseCollectionFile('- Sol Ring (C21:263) [SALE]\n')
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual(['line 1: Unrecognized token [SALE].'])
  })

  test('absent token leaves labels undefined', () => {
    const { entries } = parseCollectionFile('- Sol Ring (C21:263) [foil] &3\n')
    expect(entries[0]!.labels).toBeUndefined()
  })

  test('parses the proxy token', () => {
    const { entries, warnings } = parseCollectionFile('- Sol Ring (C21:263) [proxy] &4\n')
    expect(entries[0]!.labels).toEqual(['proxy'])
    expect(warnings).toHaveLength(0)
  })

  test('proxy-conflict refuses the line too', () => {
    const { entries, warnings } = parseCollectionFile('- Sol Ring (C21:263) [keep,proxy] &2\n')
    expect(entries).toHaveLength(0)
    expect(warnings[0]).toContain('Conflicting labels [keep,proxy]')
  })
})

describe('parseCollectionFile — front matter', () => {
  test('parses the labels default and skips the block without warnings', () => {
    const content = '---\nlabels: [sale, trade]\n---\n\n# Binder\n\n- Sol Ring (C21:263) &1\n'
    const parsed = parseCollectionFile(content)
    expect(parsed.labels).toEqual(['sale', 'trade'])
    expect(parsed.frontMatter?.raw).toBe('---\nlabels: [sale, trade]\n---\n')
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.warnings).toHaveLength(0)
    expect(parsed.advisories).toHaveLength(0)
  })

  test('captures unknown keys verbatim without interpreting them', () => {
    const content = '---\nowner: me\nlabels: [keep]\n---\n\n# Binder\n'
    const parsed = parseCollectionFile(content)
    expect(parsed.labels).toEqual(['keep'])
    expect(parsed.frontMatter?.data.owner).toBe('me')
    expect(parsed.warnings).toHaveLength(0)
  })

  test('labels: [] reads as no default while the key round-trips', () => {
    const content = '---\nlabels: []\n---\n\n# Binder\n'
    const parsed = parseCollectionFile(content)
    expect(parsed.labels).toBeUndefined()
    expect(parsed.frontMatter?.raw).toContain('labels: []')
  })

  test('an invalid labels value is an advisory, never a warning', () => {
    const content = '---\nlabels: [sale, keep]\n---\n\n# Binder\n- Sol Ring (C21:263)\n'
    const parsed = parseCollectionFile(content)
    expect(parsed.labels).toBeUndefined()
    expect(parsed.warnings).toHaveLength(0)
    expect(parsed.advisories).toHaveLength(1)
    expect(parsed.advisories[0]).toContain("Front matter 'labels' ignored")
    expect(parsed.entries).toHaveLength(1)
  })

  test('unreadable YAML is an advisory and the block still round-trips', () => {
    const content = '---\nlabels: [sale\n---\n\n# Binder\n'
    const parsed = parseCollectionFile(content)
    expect(parsed.labels).toBeUndefined()
    expect(parsed.frontMatter?.raw).toBe('---\nlabels: [sale\n---\n')
    expect(parsed.warnings).toHaveLength(0)
    expect(parsed.advisories.some((a) => a.includes('could not be read as YAML'))).toBe(true)
  })

  test('an unterminated --- block is body, warned as before', () => {
    const content = '---\nlabels: [sale]\n\n# Binder\n'
    const parsed = parseCollectionFile(content)
    expect(parsed.frontMatter).toBeUndefined()
    expect(parsed.warnings.length).toBeGreaterThan(0)
  })

  test('a fence inside front matter does not blind the body', () => {
    const content = '---\ndescription: "```"\n---\n\n# Binder\n\n- Sol Ring (C21:263) &1\n'
    const parsed = parseCollectionFile(content)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.fencedLines).toBe(0)
  })
})

describe('parseCollectionFile — language token', () => {
  test('reads a [ja] token after finish and condition', () => {
    const content = `- Sol Ring (LTC:284) [foil] [LP] [ja]\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(warnings).toHaveLength(0)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('LP')
    expect(entries[0]!.language).toBe('ja')
  })

  test('reads a language token alone, with labels, note, and id around it', () => {
    const content = `- Sol Ring (LTC:284) [zhs] [keep] {gift} &7\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(warnings).toHaveLength(0)
    expect(entries[0]!.language).toBe('zhs')
    expect(entries[0]!.labels).toEqual(['keep'])
    expect(entries[0]!.note).toBe('gift')
    expect(entries[0]!.cardId).toBe(7)
  })

  test('a bare line has no language — en is never synthesized', () => {
    const { entries } = parseCollectionFile(`- Sol Ring (C19:221) [foil] {note} &3\n`)
    expect(entries[0]!.language).toBeUndefined()
    expect(entries[0]!.note).toBe('note')
    expect(entries[0]!.cardId).toBe(3)
  })

  test('an explicit [en] token folds to no language at all', () => {
    // A bare line means English and the serializers never write `[en]`, so
    // storing `en` would give one state two spellings.
    const { entries, warnings } = parseCollectionFile(`- Sol Ring (C19:221) [en]\n`)
    expect(warnings).toHaveLength(0)
    expect(entries[0]!.language).toBeUndefined()
  })

  test('an unknown bracket token is not a language and fails the line', () => {
    const { entries, warnings, diagnostics } = parseCollectionFile(`- Sol Ring (C19:221) [jp]\n`)
    expect(entries).toHaveLength(0)
    expect(warnings).toEqual(['line 1: Unrecognized token [jp]. (did you mean [ja]?)'])
    expect(diagnostics).toMatchObject([{ code: 'unknown-token', token: '[jp]' }])
  })

  test('every token of a full line is read, whatever order they arrive in', () => {
    const { entries, warnings } = parseCollectionFile(
      '- Sol Ring (LTC:284) [ja] [LP] [keep] [foil] {x} &12\n',
    )
    expect(warnings).toHaveLength(0)
    expect(entries[0]).toMatchObject({
      name: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      labels: ['keep'],
      note: 'x',
      cardId: 12,
    })
  })
})

/**
 * The four silent-corruption rows of `research/list-format-review-2026-08-28.md`
 * §2.1 a *collection* line can exhibit, through the file parser rather than the
 * tokenizer: whitespace runs, underscore set codes, and token order all used to
 * eat the printing or leave a trailing space in the name. Row 5 (`[LP]` on a
 * wanted list) is unreachable here — a collection legitimately carries a
 * condition — and lives in `wanted-file.test.ts`; the deck half of row 4 is in
 * `importers/text-file.test.ts`.
 */
describe('parseCollectionFile — the drift defects from review §2.1', () => {
  const rows: readonly [string, string, Record<string, unknown>][] = [
    ['a double space before the printing', '- Sol Ring  (LEA:270)', { set: 'lea' }],
    [
      'a double space before a bracket token',
      '- Sol Ring (LEA:270)  [foil]',
      { set: 'lea', finish: 'foil' },
    ],
    ['an underscore set code', '- Sol Ring (PLST_X:270)', { set: 'plst_x' }],
    [
      'a condition written before the finish',
      '- Sol Ring (LEA:161) [LP] [foil]',
      { set: 'lea', finish: 'foil', condition: 'LP' },
    ],
  ]
  for (const [title, line, expected] of rows) {
    test(`${title} keeps the name and the printing`, () => {
      const { entries, warnings } = parseCollectionFile(`${line}\n`)
      expect(warnings).toEqual([])
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ name: 'Sol Ring', ...expected })
    })
  }
})

/**
 * The read tolerances are always on, in a workspace file exactly as in a pasted
 * import: one grammar, lenient in, canonical out.
 */
describe('parseCollectionFile — read tolerance', () => {
  test('an `Nx` quantity, an export printing and a finish marker all read', () => {
    const { entries, warnings, advisories, diagnostics } = parseCollectionFile(
      '- 2x Sol Ring (2XM) 129 *F*\n',
    )
    expect(warnings).toEqual([])
    // The quantity expansion is the one advisory: the dialect rewrites
    // succeeded, so they are structured detail rather than a message — and
    // "structured" is half the promise, so the structured channel is asserted
    // too. Without this, dropping those events entirely would pass.
    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toContain('Read 2 copies')
    expect(diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      'quantity-expanded',
      'dialect-rewritten',
      'dialect-rewritten',
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      name: 'Sol Ring',
      set: '2xm',
      collectorNumber: '129',
      finish: 'foil',
    })
  })

  test('a `//` in a card name is not a comment — double-faced names survive', () => {
    const { entries, warnings } = parseCollectionFile('- Fire // Ice (APC:128) &1\n')
    expect(warnings).toEqual([])
    expect(entries[0]!.name).toBe('Fire // Ice')
  })
})

/**
 * The tokenizer reads a bare name as a name-only card line, so the *file*
 * parser decides which lines to offer it. On a flat list that is the `- `
 * bullet, and nothing else — otherwise a binder's prose becomes cards.
 */
describe('parseCollectionFile — prose is never a card', () => {
  test('commentary between cards warns instead of becoming a card', () => {
    const content = [
      '# Binder',
      '',
      'These are the cards I keep in the trade folder.',
      '- Sol Ring (C21:263) &1',
      'Sol Ring is the best card in the format',
      '',
    ].join('\n')
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring'])
    expect(warnings).toEqual([
      'Skipped malformed line: These are the cards I keep in the trade folder.',
      'Skipped malformed line: Sol Ring is the best card in the format',
    ])
  })
})
