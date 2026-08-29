import { describe, expect, test, afterAll } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlink, writeFile } from 'node:fs/promises'
import { serializeCardLine } from '../../../src/list/deck-text'
import {
  IMPORT_TEXT_PARSE_OPTIONS,
  importFromTextFile,
  parseDeckText,
} from '../../../src/importers/text-file'
import { unreadableLines } from '../../../src/list/markdown-fence'

const tempFiles: string[] = []

function makeTempPath(suffix = '.md'): string {
  const p = join(tmpdir(), `ritual-test-import-${crypto.randomUUID()}${suffix}`)
  tempFiles.push(p)
  return p
}

async function writeDeck(content: string, suffix = '.md'): Promise<string> {
  const filePath = makeTempPath(suffix)
  await writeFile(filePath, content)
  return filePath
}

afterAll(async () => {
  await Promise.all(tempFiles.map((f) => unlink(f).catch(() => {})))
})

describe('parseDeckText', () => {
  test('uses the fallback name when the text has no frontmatter name', () => {
    const { deck } = parseDeckText('2 Lightning Bolt\n1 Sol Ring', 'Pasted Deck')
    expect(deck.name).toBe('Pasted Deck')
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]?.name).toBe('Main')
    expect(deck.sections[0]?.cards.map((c) => `${c.quantity} ${c.name}`)).toEqual([
      '2 Lightning Bolt',
      '1 Sol Ring',
    ])
  })

  test('frontmatter name overrides the fallback name', () => {
    const { deck } = parseDeckText(
      '---\nname: Frontmatter Deck\nformat: modern\n---\n4 Opt',
      'Fallback',
    )
    expect(deck.name).toBe('Frontmatter Deck')
    expect(deck.format).toBe('modern')
  })

  test('format is undefined when not in frontmatter', () => {
    expect(parseDeckText('---\nname: Test\n---\n1 Sol Ring', 'X').deck.format).toBeUndefined()
  })

  test('parses an empty {} note as no note at all (does not bleed into name)', () => {
    // A hand-edited file with `{}` should not corrupt the parsed card name.
    // The writer drops an empty note, so reading one as `''` would give a
    // single state two spellings.
    const { deck } = parseDeckText('1 Sol Ring {} &1', 'X')
    const card = deck.sections[0]!.cards[0]!
    expect(card.name).toBe('Sol Ring')
    expect(card.note).toBeUndefined()
    expect(card.cardId).toBe(1)
  })

  test('parses printing details and lowercases the set code', () => {
    const { deck } = parseDeckText('1 Lightning Bolt (LEA:161) [foil] [NM] {nice} &7', 'X')
    expect(deck.sections[0]?.cards[0]).toEqual({
      quantity: 1,
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'foil',
      condition: 'NM',
      note: 'nice',
      cardId: 7,
    })
  })

  test('splits sections on markdown headers and drops empty ones', () => {
    const { deck } = parseDeckText('1 Sol Ring\n\n## Sideboard\n2 Pyroblast\n\n## Empty', 'X')
    expect(deck.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard'])
    expect(deck.sections[1]?.cards[0]?.name).toBe('Pyroblast')
  })

  test.each(['Maybeboard', 'Tokens'])(
    'an empty %s section is an advisory, not a rewrite-blocking warning',
    (extras) => {
      // A leftover extras header holds nothing a re-serialize could destroy, so
      // it must not trip the whole-file save gates — which read `warnings` via
      // `unreadableLines`. The empty Sideboard in the same parse is the control:
      // the reclassification must be about extras, not about emptiness.
      const parsed = parseDeckText(`## Main\n1 Sol Ring &1\n\n## ${extras}\n\n## Sideboard\n`, 'X')
      expect(parsed.deck.sections.map((s) => s.name)).toEqual(['Main'])
      expect(parsed.advisories).toEqual([`Dropped empty section: ${extras}`])
      expect(parsed.warnings).toEqual(['Skipped empty section: Sideboard'])
      expect(unreadableLines(parsed)).toEqual(['Skipped empty section: Sideboard'])
    },
  )

  test('renames the default Main section when a header precedes any cards', () => {
    const { deck } = parseDeckText('# Commander\n1 Atraxa, Praetors Voice\n1 Sol Ring', 'X')
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]?.name).toBe('Commander')
    expect(deck.sections[0]?.cards.map((c) => c.name)).toEqual([
      'Atraxa, Praetors Voice',
      'Sol Ring',
    ])
  })

  test('yields no sections when the text contains no card lines', () => {
    const { deck } = parseDeckText('just some prose\nwith no quantities', 'X')
    expect(deck.sections).toHaveLength(0)
  })

  test('reports a warning for every skipped body line', () => {
    const { deck, warnings } = parseDeckText('## Main\n1 Sol Ring &1\nnot a card line', 'X')
    expect(deck.sections[0]?.cards).toHaveLength(1)
    expect(warnings).toEqual(['Skipped malformed line: not a card line'])
  })

  test('a misspelled language token on a malformed line names its fix', () => {
    const { warnings } = parseDeckText('## Main\nShock (M21:159) [JA]', 'X')
    expect(warnings).toEqual(['Skipped malformed line: Shock (M21:159) [JA] (did you mean [ja]?)'])
  })

  test('reports no warnings for a fully parseable deck', () => {
    const { warnings } = parseDeckText(
      '---\nname: Clean\n---\n\n## Main\n1 Sol Ring (LTC:284) &1\n',
      'X',
    )
    expect(warnings).toEqual([])
  })
})

describe('importFromTextFile - frontmatter', () => {
  test('parses YAML frontmatter with name, description, sourceUrl, sourceId', async () => {
    const filePath = await writeDeck(
      `---
name: "My Deck"
description: "Line 1\\nLine 2"
sourceUrl: "https://example.com/deck/123"
sourceId: "123"
---
## Main
4 Lightning Bolt
2 Counterspell
`,
      '.txt',
    )
    const deck = await importFromTextFile(filePath)

    expect(deck.name).toBe('My Deck')
    expect(deck.description).toBe('Line 1\nLine 2')
    expect(deck.sourceUrl).toBe('https://example.com/deck/123')
    expect(deck.sourceId).toBe('123')
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]?.cards).toEqual([
      { quantity: 4, name: 'Lightning Bolt' },
      { quantity: 2, name: 'Counterspell' },
    ])
  })

  test('falls back to filename when no name in frontmatter', async () => {
    const filePath = await writeDeck('---\n---\n## Main\n1 Sol Ring\n')
    const deck = await importFromTextFile(filePath)
    expect(deck.name).toBeTruthy()
    expect(deck.name).toMatch(/^ritual-test-import-/)
  })
})

describe('importFromTextFile - primer sidecar', () => {
  test('loads primer from sidecar .primer.md file', async () => {
    const deckPath = await writeDeck('---\nname: Test\n---\n## Main\n1 Sol Ring\n', '.txt')
    const primerPath = deckPath.replace(/\.txt$/, '.primer.md')
    await writeFile(primerPath, '## Overview\n\nThis deck does stuff.\n')
    tempFiles.push(primerPath)
    const deck = await importFromTextFile(deckPath)
    expect(deck.primer).toBe('## Overview\n\nThis deck does stuff.')
  })

  test('returns undefined primer when no sidecar file exists', async () => {
    const deckPath = await writeDeck('---\nname: Test\n---\n## Main\n1 Sol Ring\n', '.txt')
    const deck = await importFromTextFile(deckPath)
    expect(deck.primer).toBeUndefined()
  })
})

describe('importFromTextFile - mixed extended format', () => {
  test('parses deck with mixed card line formats', async () => {
    const content = [
      '---',
      'name: Mixed Formats',
      '---',
      '## Main',
      '1 Sol Ring',
      '2 Lightning Bolt (2XM:157)',
      '1 Mana Crypt (2XM:1) [foil]',
      '3 Island (SLD:63) [nonfoil] [LP]',
      '1 Ancient Tomb [etched] [HP]',
      '4x Llanowar Elves',
      '3X Brainstorm',
    ].join('\n')
    const filePath = await writeDeck(content)
    const deck = await importFromTextFile(filePath)
    const cards = deck.sections[0]!.cards
    expect(cards).toHaveLength(7)

    expect(cards[0]!.name).toBe('Sol Ring')
    expect(cards[0]!.set).toBeUndefined()

    expect(cards[1]).toMatchObject({ name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' })

    expect(cards[2]).toMatchObject({ name: 'Mana Crypt', finish: 'foil' })

    expect(cards[3]).toMatchObject({ name: 'Island', finish: 'nonfoil', condition: 'LP' })

    expect(cards[4]).toMatchObject({ name: 'Ancient Tomb', finish: 'etched', condition: 'HP' })

    expect(cards[5]).toMatchObject({ name: 'Llanowar Elves', quantity: 4 })

    expect(cards[6]).toMatchObject({ name: 'Brainstorm', quantity: 3 })
  })
})

describe('parseDeckText — fenced code blocks', () => {
  const fencedDeck = [
    '---',
    'name: Fenced Deck',
    '---',
    '',
    '## Main',
    '4 Lightning Bolt (LEA:161) &1',
    '',
    '```',
    '## Fake Section',
    '1 Black Lotus (LEA:232) &99',
    '```',
    '',
    '1 Sol Ring &2',
    '',
  ].join('\n')

  test('a fenced card line is prose: no card, no section, no warning', () => {
    const { deck, warnings, fencedLines } = parseDeckText(fencedDeck, 'fallback')
    expect(warnings).toEqual([])
    expect(fencedLines).toBe(4)
    expect(deck.sections).toHaveLength(1)
    expect(deck.sections[0]!.name).toBe('Main')
    expect(deck.sections[0]!.cards.map((c) => c.name)).toEqual(['Lightning Bolt', 'Sol Ring'])
  })

  test('prose inside a fence does not warn either', () => {
    const { warnings, fencedLines } = parseDeckText(
      ['## Main', '1 Sol Ring &1', '```text', 'not a card line at all', '```'].join('\n'),
      'fallback',
    )
    expect(warnings).toEqual([])
    expect(fencedLines).toBe(3)
  })

  test('an unclosed fence swallows the rest of the deck rather than reading it as cards', () => {
    const { deck, warnings } = parseDeckText(
      ['## Main', '1 Sol Ring &1', '```', '1 Black Lotus &2'].join('\n'),
      'fallback',
    )
    expect(warnings).toEqual([])
    expect(deck.sections[0]!.cards.map((c) => c.name)).toEqual(['Sol Ring'])
  })
})

/**
 * The MTG Arena / MTGO export dialect, which every surface reads: tolerance is
 * a property of the one card-line grammar, not a mode a caller opts into. The
 * cases that matter are: the dialect is read, Ritual's own canonical grammar is
 * never reinterpreted by it, and an *unrecognized* dialect produces an advisory
 * instead of a silently corrupted card name.
 */
describe('parseDeckText — Arena / MTGO export dialect', () => {
  test('lifts `N Name (SET) NUM` into the printing', () => {
    const { deck, warnings, advisories } = parseDeckText(
      '4 Lightning Bolt (M10) 146\n2 Shock (M20) 160',
      'Arena',
    )
    expect(warnings).toEqual([])
    expect(advisories).toEqual([])
    expect(deck.sections[0]?.cards).toEqual([
      { quantity: 4, name: 'Lightning Bolt', set: 'm10', collectorNumber: '146' },
      { quantity: 2, name: 'Shock', set: 'm20', collectorNumber: '160' },
    ])
  })

  test('refuses a set with no collector number, keeping the name and advising', () => {
    // Half a printing cannot be written to a card line (`printingSuffix` needs
    // both), so lifting it would delete the token from the file. The user's text
    // survives instead, and the advisory says the line was not understood.
    const { deck, advisories } = parseDeckText('1 Sol Ring (LTC)', 'Arena')
    expect(deck.sections[0]?.cards[0]).toMatchObject({
      quantity: 1,
      name: 'Sol Ring (LTC)',
      set: undefined,
      collectorNumber: undefined,
    })
    expect(advisories).toEqual([
      "line 1: Card name still contains a printing token, so the line's format was not recognized: 1 Sol Ring (LTC)",
    ])
  })

  test.each([
    'Very Cryptic Command (Untap)',
    'Ineffable Blessing (Cardboard)',
    'Hazmat Suit (Used)',
  ])('does not rewrite the real card name %p', (cardName) => {
    // The parenthesized-word suffix is part of these names. Requiring a
    // collector number is what keeps the dialect from inventing a printing.
    const { deck } = parseDeckText(`1 ${cardName}`, 'Arena')
    expect(deck.sections[0]?.cards[0]).toMatchObject({ name: cardName, set: undefined })
  })

  test.each([
    ['*F*', 'foil'],
    ['*E*', 'etched'],
  ])('reads a trailing %p export finish marker', (marker, finish) => {
    const { deck, advisories } = parseDeckText(`1 Sol Ring (LTC) 284 ${marker}`, 'Arena')
    expect(advisories).toEqual([])
    expect(deck.sections[0]?.cards[0]).toMatchObject({
      name: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish,
    })
  })

  test('a finish marker is read wherever it appears — tolerance is not a mode', () => {
    // Read tolerance belongs to the one card-line grammar, not to the surface
    // that called it: a `*F*` means foil in a workspace file too, and the next
    // save writes it back as the canonical `[foil]`.
    const { deck, advisories } = parseDeckText('1 Sol Ring *F*', 'fallback')
    expect(deck.sections[0]?.cards[0]).toMatchObject({ name: 'Sol Ring', finish: 'foil' })
    // The rewrite succeeded, so it is structured detail rather than an advisory.
    expect(advisories).toEqual([])
  })

  test.each(['Constructor', '__proto__', 'toString'])(
    'the marker lookup does not resolve the inherited key %p',
    (line) => {
      // The lookup key is arbitrary file content; an object literal would answer
      // these with something other than `undefined` and start a section named by
      // a function.
      const { deck, warnings } = parseDeckText(`${line}\n1 Sol Ring (M19) 1\n`, 'fallback')
      expect(warnings).toEqual([`Skipped malformed line: ${line}`])
      expect(deck.sections.map((s) => s.name)).toEqual(['Main'])
    },
  )

  test('maps the Companion marker onto a section', () => {
    const { deck, warnings } = parseDeckText(
      'Companion\n1 Lurrus of the Dream-Den (IKO) 226\n\nDeck\n4 Mountain (M20) 274\n',
      'Arena',
    )
    expect(warnings).toEqual([])
    expect(deck.sections.map((s) => s.name)).toEqual(['Companion', 'Main'])
  })

  test('a marker with no cards under it warns like an empty `##` header', () => {
    // Markers start a level-2 section deliberately: a marker whose cards went
    // missing must not be silently dropped by a re-serialize.
    // At level 1 the leading bucket is a document title and is exempt, so this
    // assertion is what pins the marker's `##`-equivalence.
    const { warnings } = parseDeckText('Commander\n\nDeck\n4 Mountain (M20) 274\n', 'Arena')
    expect(warnings).toEqual(['Skipped empty section: Commander'])
  })

  test('lowercases the set code and keeps a starred collector number', () => {
    const { deck } = parseDeckText('1 Llanowar Elves (M19) 314★', 'Arena')
    expect(deck.sections[0]?.cards[0]).toMatchObject({ set: 'm19', collectorNumber: '314★' })
  })

  test('maps bare marker lines onto sections', () => {
    const { deck, warnings } = parseDeckText(
      'Commander\n1 Krenko, Mob Boss (M19) 149\n\nDeck\n4 Mountain (M20) 274\n\nSideboard\n2 Pyroblast (ICE) 213\n',
      'Arena',
    )
    expect(warnings).toEqual([])
    expect(deck.sections.map((s) => s.name)).toEqual(['Commander', 'Main', 'Sideboard'])
    expect(deck.sections[1]?.cards[0]?.name).toBe('Mountain')
  })

  test('names the deck from an About block and skips its other lines with an advisory', () => {
    const { deck, warnings, advisories } = parseDeckText(
      'About\nName Mono-Red Aggro\nSomething Else\n\nDeck\n4 Shock (M20) 160\n',
      'fallback',
    )
    expect(deck.name).toBe('Mono-Red Aggro')
    expect(warnings).toEqual([])
    expect(advisories).toEqual(['Skipped About line: Something Else'])
  })

  test('frontmatter name still wins over an About name', () => {
    const { deck } = parseDeckText(
      '---\nname: Front Matter Deck\n---\nAbout\nName Arena Name\n\nDeck\n1 Shock (M20) 160\n',
      'fallback',
    )
    expect(deck.name).toBe('Front Matter Deck')
  })

  test('does not reinterpret canonical Ritual card lines', () => {
    const line = '1 Lightning Bolt (LEA:161) [foil] [NM] {trade binder} &12'
    const { deck, advisories, warnings } = parseDeckText(line, 'Canonical')
    expect(warnings).toEqual([])
    expect(advisories).toEqual([])
    expect(deck.sections[0]?.cards[0]).toEqual({
      quantity: 1,
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'foil',
      condition: 'NM',
      note: 'trade binder',
      cardId: 12,
    })
  })

  test('a canonical note containing a printing token is left alone', () => {
    const { deck, advisories } = parseDeckText('1 Lightning Bolt {was (M10) 146}', 'Canonical')
    expect(advisories).toEqual([])
    expect(deck.sections[0]?.cards[0]).toMatchObject({
      name: 'Lightning Bolt',
      note: 'was (M10) 146',
      set: undefined,
    })
  })

  test('a marker line and an export printing are read wherever they appear', () => {
    // The dialect stopped being a mode in P2: one grammar, always tolerant, so
    // a workspace file that picked up Arena shapes reads the same as an import.
    const { deck, warnings, advisories } = parseDeckText(
      'Sideboard\n4 Lightning Bolt (M10) 146',
      'Strict',
    )
    expect(warnings).toEqual([])
    expect(advisories).toEqual([])
    expect(deck.sections.map((s) => s.name)).toEqual(['Sideboard'])
    expect(deck.sections[0]?.cards[0]).toMatchObject({
      name: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
    })
  })

  test('a printing token the dialect cannot lift still advises', () => {
    // A printing token with no card name in front of it: the Arena grammar
    // cannot lift it (that would leave a nameless card), so the line is imported
    // as-is and the advisory says the format was not understood.
    const { deck, advisories } = parseDeckText('4 (M10) 146', 'Odd')
    expect(deck.sections[0]?.cards[0]?.name).toBe('(M10) 146')
    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toContain('still contains a printing token')
  })

  test('a plain card name never triggers an advisory', () => {
    const { advisories } = parseDeckText('4 Lightning Bolt\n1 Sol Ring', 'Plain')
    expect(advisories).toEqual([])
  })
})

/**
 * On the import path a ``` fence is packaging, not prose: a decklist pasted
 * from Discord, Reddit, or GitHub arrives wrapped in one, and reading it as
 * prose imported zero cards while reporting success.
 */
describe('parseDeckText — fenced content on the import path', () => {
  test('a wholly fenced decklist imports its cards', () => {
    const { deck, warnings, advisories, fencedLines } = parseDeckText(
      '```\n4 Lightning Bolt (M10) 146\n2 Shock (M20) 160\n```\n',
      'Pasted',
      undefined,
      IMPORT_TEXT_PARSE_OPTIONS,
    )
    expect(warnings).toEqual([])
    expect(advisories).toEqual([])
    // Nothing is prose-only, so nothing is reported as un-re-emittable.
    expect(fencedLines).toBe(0)
    expect(deck.sections[0]?.cards.map((c) => c.name)).toEqual(['Lightning Bolt', 'Shock'])
  })

  test('a fenced section header inside the block still starts a section', () => {
    const { deck } = parseDeckText(
      '4 Lightning Bolt (M10) 146\n\n```\nSideboard\n2 Shock (M20) 160\n```\n',
      'Pasted',
      undefined,
      IMPORT_TEXT_PARSE_OPTIONS,
    )
    expect(deck.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard'])
  })

  test('an info string on the fence is dropped rather than warned about', () => {
    const { warnings, deck } = parseDeckText(
      '```text\n4 Lightning Bolt (M10) 146\n```',
      'Pasted',
      undefined,
      IMPORT_TEXT_PARSE_OPTIONS,
    )
    expect(warnings).toEqual([])
    expect(deck.sections[0]?.cards).toHaveLength(1)
  })

  test('a workspace load still treats a fence as prose', () => {
    // The default must not change: in Ritual's own files a fenced block is an
    // example, and reading it would invent cards.
    const { deck, fencedLines } = parseDeckText(
      '## Main\n1 Sol Ring &1\n```\n1 Black Lotus (LEA:232) &99\n```\n',
      'fallback',
    )
    expect(fencedLines).toBe(3)
    expect(deck.sections[0]?.cards.map((c) => c.name)).toEqual(['Sol Ring'])
  })
})

describe('parseDeckText — language token', () => {
  test('reads a [ja] token after finish and condition', () => {
    const { deck, warnings } = parseDeckText('## Main\n2 Sol Ring (LTC:284) [foil] [LP] [ja]', 'd')
    expect(warnings).toHaveLength(0)
    const card = deck.sections[0]!.cards[0]!
    expect(card.finish).toBe('foil')
    expect(card.condition).toBe('LP')
    expect(card.language).toBe('ja')
  })

  test('reads a language token alone, with note and id after it', () => {
    const { deck, warnings } = parseDeckText('## Main\n1 Sol Ring (LTC:284) [zhs] {gift} &7', 'd')
    expect(warnings).toHaveLength(0)
    const card = deck.sections[0]!.cards[0]!
    expect(card.language).toBe('zhs')
    expect(card.note).toBe('gift')
    expect(card.cardId).toBe(7)
  })

  test('a bare line has no language — en is never synthesized', () => {
    const { deck } = parseDeckText('## Main\n1 Sol Ring (LTC:284) [foil] {note} &3', 'd')
    const card = deck.sections[0]!.cards[0]!
    expect(card.language).toBeUndefined()
    expect(card.note).toBe('note')
    expect(card.cardId).toBe(3)
  })

  test('an explicit [en] token folds to no language at all', () => {
    // A bare line means English and the serializer never writes `[en]`, so
    // storing `en` would give one state two spellings.
    const { deck, warnings } = parseDeckText('## Main\n1 Sol Ring (LTC:284) [en]', 'd')
    expect(warnings).toHaveLength(0)
    expect(deck.sections[0]!.cards[0]!.language).toBeUndefined()
  })

  test('[jp] is not a language: a line with no quantity is prose, and warns as such', () => {
    // No leading quantity, so it is not a card candidate at all — the file
    // parser reports it as an unreadable line, hint included.
    const { deck, warnings } = parseDeckText('## Main\nShock (M21:159) [jp]', 'd')
    expect(deck.sections[0]?.cards ?? []).toHaveLength(0)
    expect(warnings).toEqual(['Skipped malformed line: Shock (M21:159) [jp] (did you mean [ja]?)'])
  })

  test('[jp] on a card line is refused by name, never swallowed into the name', () => {
    // The old grammar backtracked the unknown token into the card name and
    // said nothing, so the card missed the cache, Scryfall and every sync join.
    const { deck, warnings, diagnostics } = parseDeckText('## Main\n1 Shock (M21:159) [jp]', 'd')
    expect(deck.sections[0]?.cards ?? []).toHaveLength(0)
    expect(warnings).toEqual(['line 2: Unrecognized token [jp]. (did you mean [ja]?)'])
    expect(diagnostics).toMatchObject([{ code: 'unknown-token', token: '[jp]' }])
  })

  test('a diagnostic line number counts the front-matter block', () => {
    // The deck parser reads the body gray-matter hands back, so every card-line
    // diagnostic is offset by where the block ends. An off-by-one here points
    // the user (and an editor squiggle) at the wrong line of their file.
    const content = '---\nname: D\n---\n\n## Main\n1 Shock (M21:159) [jp]'
    expect(parseDeckText(content, 'd').warnings).toEqual([
      'line 6: Unrecognized token [jp]. (did you mean [ja]?)',
    ])
    expect(
      parseDeckText(content, 'd', undefined, { file: 'decks/burn.md' }).warnings[0],
    ).toStartWith('decks/burn.md:6: ')
  })

  test('every token of a full line is read, whatever order they arrive in', () => {
    const { deck, warnings } = parseDeckText(
      '## Main\n2 Sol Ring [proxy] (LTC:284) [ja] {x} [LP] [foil] &12',
      'd',
    )
    expect(warnings).toHaveLength(0)
    expect(deck.sections[0]!.cards[0]).toEqual({
      quantity: 2,
      name: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      labels: ['proxy'],
      note: 'x',
      cardId: 12,
    })
  })

  test("a [proxy] token parses as the line's label override and round-trips", () => {
    const line = '- 2 Sol Ring (LTC:284) [foil] [ja] [proxy] {mine} &7'
    const { deck, warnings } = parseDeckText(`## Main\n${line}`, 'd')
    const card = deck.sections[0]!.cards[0]!
    expect(warnings).toHaveLength(0)
    expect(card.labels).toEqual(['proxy'])
    expect(serializeCardLine(card)).toBe(line)
  })

  test('a label a deck cannot carry warns, keeping the card without the labels', () => {
    const { deck, warnings } = parseDeckText('## Main\n1 Sol Ring (LTC:284) [keep] &1', 'd')
    const card = deck.sections[0]!.cards[0]!
    expect(card.name).toBe('Sol Ring')
    expect(card.labels).toBeUndefined()
    expect(warnings[0]).toContain('[keep]')
    expect(warnings[0]).toContain('not supported on a deck')
  })

  test('a front-matter labels default the deck cannot carry warns', () => {
    // The next whole-file save deletes the key (`validateDeckFrontMatter` drops
    // it), so this is a warning — the same treatment a refused card-line token
    // gets, and what makes the rewrite gates block.
    const { deck, warnings } = parseDeckText(
      '---\nname: D\nlabels: [sale]\n---\n\n## Main\n1 Sol Ring (LTC:284) &1',
      'd',
    )
    expect(deck.sections[0]!.cards[0]!.name).toBe('Sol Ring')
    expect(warnings[0]).toContain("Front matter 'labels' ignored")
    expect(warnings[0]).toContain('not supported on a deck')
  })

  test('a legal front-matter labels default is silent', () => {
    const { warnings } = parseDeckText(
      '---\nname: D\nlabels: [proxy]\n---\n\n## Main\n1 Sol Ring (LTC:284) &1',
      'd',
    )
    expect(warnings).toHaveLength(0)
  })

  test('a conflicting labels token refuses the line and names both labels', () => {
    // A self-conflicting token is a grammar refusal, not a value one: the line
    // is skipped and warns, so the rewrite gates block until it is fixed.
    const { deck, warnings } = parseDeckText('## Main\n1 Sol Ring (LTC:284) [sale,proxy] &1', 'd')
    expect(deck.sections[0]?.cards ?? []).toHaveLength(0)
    expect(warnings).toEqual([
      'line 2: Conflicting labels [sale,proxy] — [proxy] cannot be combined with any other label.',
    ])
  })

  test('a name-only deck line takes a language token', () => {
    const { deck } = parseDeckText('## Main\n3 Sol Ring [ja]', 'd')
    const card = deck.sections[0]!.cards[0]!
    expect(card.name).toBe('Sol Ring')
    expect(card.set).toBeUndefined()
    expect(card.language).toBe('ja')
  })
})

/**
 * The read tolerances are always on, in a workspace file exactly as in a pasted
 * import: one grammar, lenient in, canonical out. A file that picked up an
 * export's shapes is read, not refused — and the next save writes it back
 * canonically.
 */
describe('parseDeckText — read tolerance in a workspace file', () => {
  test('an `Nx` quantity, an export printing and a finish marker all read', () => {
    const { deck, warnings, advisories } = parseDeckText(
      '## Main\n4x Lightning Bolt (2XM) 129 *F*\n',
      'Workspace',
    )
    expect(warnings).toEqual([])
    expect(advisories).toEqual([])
    expect(deck.sections[0]!.cards[0]).toMatchObject({
      quantity: 4,
      name: 'Lightning Bolt',
      set: '2xm',
      collectorNumber: '129',
      finish: 'foil',
    })
  })

  test('a `//` comment is a recognized line kind, not an unreadable line', () => {
    const { deck, warnings, advisories } = parseDeckText(
      '## Main\n// pulled from the primer\n1 Sol Ring (LTC:284) &1\n',
      'Workspace',
    )
    expect(warnings).toEqual([])
    expect(advisories).toEqual([])
    expect(deck.sections[0]!.cards.map((c) => c.name)).toEqual(['Sol Ring'])
  })

  test('a `//` in a card name is not a comment — double-faced names survive', () => {
    const { deck, warnings } = parseDeckText('## Main\n1 Fire // Ice (APC:128) &1\n', 'Workspace')
    expect(warnings).toEqual([])
    expect(deck.sections[0]!.cards[0]!.name).toBe('Fire // Ice')
  })

  test('a whitespace run between tokens no longer eats the printing', () => {
    const { deck, warnings } = parseDeckText('## Main\n1  Sol Ring  (LTC:284)   [foil]\n', 'W')
    expect(warnings).toEqual([])
    expect(deck.sections[0]!.cards[0]).toMatchObject({
      name: 'Sol Ring',
      set: 'ltc',
      finish: 'foil',
    })
  })
})

/**
 * The tokenizer reads a bare name as a name-only card line, so the *file*
 * parser decides which lines to offer it: in a deck that is a leading quantity.
 * An imported decklist's commentary must stay commentary.
 */
describe('parseDeckText — prose is never a card', () => {
  test('commentary between card lines warns instead of becoming cards', () => {
    const content = [
      '## Main',
      '1 Sol Ring (LTC:284) &1',
      'Sideboard ideas: maybe a counterspell',
      'Sol Ring is the best card in the format',
    ].join('\n')
    const { deck, warnings } = parseDeckText(content, 'X')
    expect(deck.sections[0]!.cards.map((c) => c.name)).toEqual(['Sol Ring'])
    expect(warnings).toEqual([
      'Skipped malformed line: Sideboard ideas: maybe a counterspell',
      'Skipped malformed line: Sol Ring is the best card in the format',
    ])
  })
})
