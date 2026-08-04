import { describe, expect, test } from 'bun:test'
import {
  COLLECTION_CARD_LINE_RE,
  parseCollectionFile,
  resolveFinish,
  type CollectionEntry,
} from '../../src/collection-file'
import { CARD_LABELS } from '../../src/card-labels'
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

/**
 * Collections and wanted lists hold one line per copy, so a deck-style quantity
 * prefix lands in the card name and quietly names a card nothing will match.
 * It is an *advisory* rather than a warning: the line parsed and a save would
 * re-emit it verbatim, so it must not trip the whole-file-rewrite gates that
 * exist for content a save would delete.
 */
describe('parseCollectionFile — deck-style quantity prefixes', () => {
  test('advises on a leading quantity, without dropping the line', () => {
    const { entries, warnings, advisories } = parseCollectionFile('- 1 Sol Ring (C21:240)\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('1 Sol Ring')
    expect(warnings).toHaveLength(0)
    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toContain("named '1 Sol Ring'")
    expect(advisories[0]).toContain('one line per copy')
  })

  test('advises on multi-digit quantities too', () => {
    const { advisories } = parseCollectionFile('- 12 Lightning Bolt (LEA:161) [foil]\n')
    expect(advisories).toHaveLength(1)
  })

  test('leaves a card name that legitimately starts with a year alone', () => {
    // `1996 World Champion` is a real card: only a 1-3 digit leading integer
    // reads as a quantity, so four digits parse untouched and unremarked.
    const { entries, advisories } = parseCollectionFile('- 1996 World Champion (PCEL:1)\n')
    expect(entries[0]!.name).toBe('1996 World Champion')
    expect(advisories).toEqual([])
  })

  test('a bare number is a name, not a quantity', () => {
    const { advisories } = parseCollectionFile('- 60 (UNF:1)\n')
    expect(advisories).toEqual([])
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

  test('keep-conflict keeps the entry, drops the labels, and warns', () => {
    const { entries, warnings } = parseCollectionFile('- Sol Ring (C21:263) [sale,keep] &2\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.labels).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Conflicting labels [sale,keep]')
    expect(warnings[0]).toContain('rewrite would drop them')
  })

  test('an uppercase token is not a labels token — the line warns like any unknown bracket', () => {
    // The unmatched bracket is absorbed into the lazy name group (exactly as
    // `[FOIL]` behaves), so the entry fails the printing requirement and warns.
    const { entries, warnings } = parseCollectionFile('- Sol Ring (C21:263) [SALE]\n')
    expect(entries).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('missing set code')
  })

  test('absent token leaves labels undefined', () => {
    const { entries } = parseCollectionFile('- Sol Ring (C21:263) [foil] &3\n')
    expect(entries[0]!.labels).toBeUndefined()
  })

  test('the line regex embeds the CARD_LABELS vocabulary', () => {
    // The token alternation is spelled out in the regex literal; this pins it
    // to the canonical vocabulary so adding a label cannot silently leave the
    // grammar behind.
    expect(COLLECTION_CARD_LINE_RE.source).toContain(CARD_LABELS.join('|'))
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
