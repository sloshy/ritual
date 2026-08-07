import { describe, expect, test, afterAll } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlink, writeFile } from 'node:fs/promises'
import {
  DECK_CARD_LINE_RE,
  DECK_LINE_LANGUAGE_GROUP,
  IMPORT_TEXT_PARSE_OPTIONS,
  importFromTextFile,
  matchArenaSuffix,
  parseDeckText,
} from '../../../src/importers/text-file'

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

  test('parses an empty {} note as empty string (does not bleed into name)', () => {
    // A hand-edited file with `{}` should not corrupt the parsed card name.
    const { deck } = parseDeckText('1 Sol Ring {} &1', 'X')
    const card = deck.sections[0]!.cards[0]!
    expect(card.name).toBe('Sol Ring')
    expect(card.note).toBe('')
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
 * The MTG Arena / MTGO export dialect, which only the import surfaces opt into.
 * The cases that matter are: the dialect is read when asked for, Ritual's own
 * canonical grammar is never reinterpreted by it, and an unrecognized dialect
 * produces an advisory instead of a silently corrupted card name.
 */
describe('parseDeckText — Arena dialect', () => {
  const arena = { arenaDialect: true }

  test('lifts `N Name (SET) NUM` into the printing', () => {
    const { deck, warnings, advisories } = parseDeckText(
      '4 Lightning Bolt (M10) 146\n2 Shock (M20) 160',
      'Arena',
      undefined,
      arena,
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
    const { deck, advisories } = parseDeckText('1 Sol Ring (LTC)', 'Arena', undefined, arena)
    expect(deck.sections[0]?.cards[0]).toMatchObject({
      quantity: 1,
      name: 'Sol Ring (LTC)',
      set: undefined,
      collectorNumber: undefined,
    })
    expect(advisories).toEqual([
      "Card name still contains a printing token, so the line's format was not recognized: 1 Sol Ring (LTC)",
    ])
  })

  test.each([
    'Very Cryptic Command (Untap)',
    'Ineffable Blessing (Cardboard)',
    'Hazmat Suit (Used)',
  ])('does not rewrite the real card name %p', (cardName) => {
    // The parenthesized-word suffix is part of these names. Requiring a
    // collector number is what keeps the dialect from inventing a printing.
    const { deck } = parseDeckText(`1 ${cardName}`, 'Arena', undefined, arena)
    expect(deck.sections[0]?.cards[0]).toMatchObject({ name: cardName, set: undefined })
  })

  test.each([
    ['*F*', 'foil'],
    ['*E*', 'etched'],
  ])('reads a trailing %p export finish marker', (marker, finish) => {
    const { deck, advisories } = parseDeckText(
      `1 Sol Ring (LTC) 284 ${marker}`,
      'Arena',
      undefined,
      arena,
    )
    expect(advisories).toEqual([])
    expect(deck.sections[0]?.cards[0]).toMatchObject({
      name: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish,
    })
  })

  test('a finish marker is not read outside the dialect', () => {
    // Ritual's own files spell a finish `[foil]`; a `*F*` there is name text.
    const { deck } = parseDeckText('1 Sol Ring *F*', 'fallback')
    expect(deck.sections[0]?.cards[0]).toMatchObject({ name: 'Sol Ring *F*', finish: undefined })
  })

  test.each(['Constructor', '__proto__', 'toString'])(
    'the marker lookup does not resolve the inherited key %p',
    (line) => {
      // The lookup key is arbitrary file content; an object literal would answer
      // these with something other than `undefined` and start a section named by
      // a function.
      const { deck, warnings } = parseDeckText(
        `${line}\n1 Sol Ring (M19) 1\n`,
        'fallback',
        undefined,
        arena,
      )
      expect(warnings).toEqual([`Skipped malformed line: ${line}`])
      expect(deck.sections.map((s) => s.name)).toEqual(['Main'])
    },
  )

  test('maps the Companion marker onto a section', () => {
    const { deck, warnings } = parseDeckText(
      'Companion\n1 Lurrus of the Dream-Den (IKO) 226\n\nDeck\n4 Mountain (M20) 274\n',
      'Arena',
      undefined,
      arena,
    )
    expect(warnings).toEqual([])
    expect(deck.sections.map((s) => s.name)).toEqual(['Companion', 'Main'])
  })

  test('a marker with no cards under it warns like an empty `##` header', () => {
    // Markers start a level-2 section deliberately: a marker whose cards went
    // missing must not be silently dropped by a re-serialize.
    // At level 1 the leading bucket is a document title and is exempt, so this
    // assertion is what pins the marker's `##`-equivalence.
    const { warnings } = parseDeckText(
      'Commander\n\nDeck\n4 Mountain (M20) 274\n',
      'Arena',
      undefined,
      arena,
    )
    expect(warnings).toEqual(['Skipped empty section: Commander'])
  })

  test('lowercases the set code and keeps a starred collector number', () => {
    const { deck } = parseDeckText('1 Llanowar Elves (M19) 314★', 'Arena', undefined, arena)
    expect(deck.sections[0]?.cards[0]).toMatchObject({ set: 'm19', collectorNumber: '314★' })
  })

  test('maps bare marker lines onto sections', () => {
    const { deck, warnings } = parseDeckText(
      'Commander\n1 Krenko, Mob Boss (M19) 149\n\nDeck\n4 Mountain (M20) 274\n\nSideboard\n2 Pyroblast (ICE) 213\n',
      'Arena',
      undefined,
      arena,
    )
    expect(warnings).toEqual([])
    expect(deck.sections.map((s) => s.name)).toEqual(['Commander', 'Main', 'Sideboard'])
    expect(deck.sections[1]?.cards[0]?.name).toBe('Mountain')
  })

  test('names the deck from an About block and skips its other lines with an advisory', () => {
    const { deck, warnings, advisories } = parseDeckText(
      'About\nName Mono-Red Aggro\nSomething Else\n\nDeck\n4 Shock (M20) 160\n',
      'fallback',
      undefined,
      arena,
    )
    expect(deck.name).toBe('Mono-Red Aggro')
    expect(warnings).toEqual([])
    expect(advisories).toEqual(['Skipped About line: Something Else'])
  })

  test('frontmatter name still wins over an About name', () => {
    const { deck } = parseDeckText(
      '---\nname: Front Matter Deck\n---\nAbout\nName Arena Name\n\nDeck\n1 Shock (M20) 160\n',
      'fallback',
      undefined,
      arena,
    )
    expect(deck.name).toBe('Front Matter Deck')
  })

  test('does not reinterpret canonical Ritual card lines', () => {
    const line = '1 Lightning Bolt (LEA:161) [foil] [NM] {trade binder} &12'
    const { deck, advisories, warnings } = parseDeckText(line, 'Canonical', undefined, arena)
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
    const { deck, advisories } = parseDeckText(
      '1 Lightning Bolt {was (M10) 146}',
      'Canonical',
      undefined,
      arena,
    )
    expect(advisories).toEqual([])
    expect(deck.sections[0]?.cards[0]).toMatchObject({
      name: 'Lightning Bolt',
      note: 'was (M10) 146',
      set: undefined,
    })
  })

  test('without the dialect a marker line is a skipped line and the printing stays in the name', () => {
    const { deck, warnings, advisories } = parseDeckText(
      'Sideboard\n4 Lightning Bolt (M10) 146',
      'Strict',
    )
    // Strict loads of workspace files keep the old behavior — nothing is
    // silently reinterpreted — but the suspicious name is now called out.
    expect(warnings).toEqual(['Skipped malformed line: Sideboard'])
    expect(deck.sections[0]?.cards[0]?.name).toBe('Lightning Bolt (M10) 146')
    expect(advisories).toEqual([
      "Card name still contains a printing token, so the line's format was not recognized: 4 Lightning Bolt (M10) 146",
    ])
  })

  test('a printing token the dialect cannot lift still advises', () => {
    // A printing token with no card name in front of it: the Arena grammar
    // cannot lift it (that would leave a nameless card), so the line is imported
    // as-is and the advisory says the format was not understood.
    const { deck, advisories } = parseDeckText('4 (M10) 146', 'Odd', undefined, arena)
    expect(deck.sections[0]?.cards[0]?.name).toBe('(M10) 146')
    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toContain('still contains a printing token')
  })

  test('a plain card name never triggers an advisory', () => {
    const { advisories } = parseDeckText('4 Lightning Bolt\n1 Sol Ring', 'Plain', undefined, arena)
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

describe('matchArenaSuffix', () => {
  test('a complete printing is liftable', () => {
    expect(matchArenaSuffix('Lightning Bolt (M10) 146')).toEqual({
      kind: 'printing',
      name: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
    })
  })

  test.each(['Sol Ring (LTC)', 'Very Cryptic Command (Untap)', '(M10) 146'])(
    'a set-like token with no complete printing is only suspect: %p',
    (name) => {
      expect(matchArenaSuffix(name)).toEqual({ kind: 'suspect' })
    },
  )

  test.each(['Lightning Bolt', 'Sol Ring (LEA:1)', 'Fire // Ice'])(
    'an ordinary name matches nothing: %p',
    (name) => {
      expect(matchArenaSuffix(name)).toEqual({ kind: 'none' })
    },
  )
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

  test('an explicit [en] token is read as en, not folded to undefined', () => {
    // The serializer never writes [en], but a hand-written token must still
    // parse: absent-vs-en is a write-side fold, not a read-side one.
    const { deck, warnings } = parseDeckText('## Main\n1 Sol Ring (LTC:284) [en]', 'd')
    expect(warnings).toHaveLength(0)
    expect(deck.sections[0]!.cards[0]!.language).toBe('en')
  })

  test('[jp] is not a language: the line fails with the did-you-mean hint', () => {
    // Mirrors the collection parser's [jp] rejection. Only the quantity-less
    // form reaches the malformed branch — with a leading quantity the grammar
    // backtracks the unknown token into the card name instead (pinned below).
    const { deck, warnings } = parseDeckText('## Main\nShock (M21:159) [jp]', 'd')
    expect(deck.sections[0]?.cards ?? []).toHaveLength(0)
    expect(warnings).toEqual(['Skipped malformed line: Shock (M21:159) [jp] (did you mean [ja]?)'])
  })

  test('a quantity line swallows an unknown bracket token into the name (no warning)', () => {
    // Documented limitation: `1 Shock (M21:159) [jp]` matches the name-only
    // grammar, so the token lands inside the name silently. If this ever warns
    // instead, that is an improvement — update this pin, not the parser back.
    const { deck, warnings } = parseDeckText('## Main\n1 Shock (M21:159) [jp]', 'd')
    expect(warnings).toHaveLength(0)
    expect(deck.sections[0]!.cards[0]!.name).toBe('Shock (M21:159) [jp]')
    expect(deck.sections[0]!.cards[0]!.language).toBeUndefined()
  })

  test('the DECK_CARD_LINE_RE keeps &N as the final capture group', () => {
    const match = '2 Sol Ring (LTC:284) [foil] [LP] [ja] {x} &12'.match(DECK_CARD_LINE_RE)!
    expect(match[match.length - 1]).toBe('12')
    expect(match[DECK_LINE_LANGUAGE_GROUP]).toBe('ja')
  })

  test('a name-only deck line takes a language token', () => {
    const { deck } = parseDeckText('## Main\n3 Sol Ring [ja]', 'd')
    const card = deck.sections[0]!.cards[0]!
    expect(card.name).toBe('Sol Ring')
    expect(card.set).toBeUndefined()
    expect(card.language).toBe('ja')
  })
})
