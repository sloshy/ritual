/**
 * Tests for the MIGRATION-ONLY legacy prose parser. Delete with the module once
 * every workspace has been migrated. Every writer shape (all 15 actions, the
 * cross-list moves included) and every legacy leniency (unquoted names, missing
 * `&N`) is pinned here so `ritual cleanup` converts old entries faithfully.
 */

import { describe, test, expect } from 'bun:test'
import {
  parseLegacyChangeLine,
  parseLegacyChangeLines,
} from '../../src/changes/changelog-legacy-parser'
import { parseChangeSets } from '../../src/changes/changelog-blocks'
import type { ChangeEvent } from '../../src/changes/change-event'

/** The placeholder envelope every legacy-parsed event carries. */
const ENVELOPE = { id: '', timestamp: 0 } as const

/** One legacy entry converted: its events, and the lines no grammar accepted. */
type LegacyPage = { timestamp: string; changes: ChangeEvent[]; unparsed: string[] }

/** Read a legacy changelog the way the migration will: entries by block scan, lines by the legacy grammar. Newest first. */
function parseLegacy(content: string): { pages: LegacyPage[] } {
  const pages: LegacyPage[] = []
  for (const set of parseChangeSets(content, '').sets) {
    const { events, unparsedLines } = parseLegacyChangeLines(set.lines)
    if (events.length > 0) {
      pages.push({ timestamp: set.timestamp, changes: events, unparsed: unparsedLines })
    }
  }
  pages.reverse()
  return { pages }
}

describe('legacy prose parser', () => {
  test('parses a simple changelog with one entry', () => {
    const content = `# Changelog for Test Deck

## 2026-03-07T22:01:21.452Z

- Removed Misty Rainforest
`
    const { pages } = parseLegacy(content)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.timestamp).toBe('2026-03-07T22:01:21.452Z')
    expect(pages[0]!.changes).toHaveLength(1)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'remove',
      cardName: 'Misty Rainforest',
    })
  })

  test('parses added card with set:collectorNumber', () => {
    const content = `# Changelog

## 2026-03-07T00:00:00Z

- Added Demonic Tutor (UMA:93)
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Demonic Tutor',
      set: 'uma',
      collectorNumber: '93',
    })
  })

  test('parses card with finish and condition brackets', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Added Sol Ring (MH3:301) [foil] [LP]
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Sol Ring',
      set: 'mh3',
      collectorNumber: '301',
      finish: 'foil',
      condition: 'LP',
    })
  })

  test('parses "Set X as commander"', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set Avacyn, Angel of Hope as commander
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-commander',
      cardName: 'Avacyn, Angel of Hope',
    })
  })

  test('parses "Unset X as commander"', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Unset Avacyn, Angel of Hope as commander
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'unset-commander',
      cardName: 'Avacyn, Angel of Hope',
    })
  })

  test('parses "Set X finish to foil"', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set Sol Ring finish to foil
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-finish',
      cardName: 'Sol Ring',
      finish: 'foil',
    })
  })

  test('parses "Set X printing to SET:CN [finish]"', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set "Lightning Bolt" printing to M10:146 [foil] &5
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      cardId: 5,
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
      condition: undefined,
    })
  })

  test('parses "Set X printing to SET:CN [finish] [condition]"', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set "Lightning Bolt" printing to M10:146 [foil] [LP] &5
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      cardId: 5,
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
      condition: 'LP',
    })
  })

  test('parses "Set X printing to no specific printing" as name-only', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set "Lightning Bolt" printing to no specific printing &5
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      cardId: 5,
    })
  })

  test('parses "Set language of X to <name>" into the language code', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set language of "Sol Ring" to Japanese &5
- Set language of "Sol Ring" to Simplified Chinese
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-language',
      cardName: 'Sol Ring',
      cardId: 5,
      language: 'ja',
    })
    // Multi-word display names parse too — the &N-less form as well.
    expect(pages[0]!.changes[1]).toEqual({
      ...ENVELOPE,
      action: 'set-language',
      cardName: 'Sol Ring',
      language: 'zhs',
    })
  })

  test('a quoted card name containing " to " does not split the language early', () => {
    // Regression: lazy groups used to split on the FIRST " to ", so this line
    // failed to parse and vanished from history.
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set language of "Ashes to Ashes" to Japanese &5
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-language',
      cardName: 'Ashes to Ashes',
      cardId: 5,
      language: 'ja',
    })
  })

  test('drops a "Set language" line naming no known language', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set language of "Sol Ring" to Klingon &5
`
    const { pages } = parseLegacy(content)
    expect(pages).toHaveLength(0)
  })

  test('classifies a [ja] bracket on add/remove lines as the language', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Added "Ambition's Cost" (NEO:234) [foil] [LP] [ja] &7
- Removed "Sol Ring" [ja]
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: "Ambition's Cost",
      cardId: 7,
      set: 'neo',
      collectorNumber: '234',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
    })
    expect(pages[0]!.changes[1]).toEqual({
      ...ENVELOPE,
      action: 'remove',
      cardName: 'Sol Ring',
      language: 'ja',
    })
  })

  test('parses a [ja] token inside a set-printing descriptor', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set "Lightning Bolt" printing to M10:146 [foil] [ja] &5
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      cardId: 5,
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
      condition: undefined,
      language: 'ja',
    })
  })

  test('parses a non-main board suffix without polluting the card name', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added Cavern-Hoard Dragon to Maybeboard
- Removed Lightning Bolt from Sideboard
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Cavern-Hoard Dragon',
      board: 'Maybeboard',
    })
    expect(pages[0]!.changes[1]).toEqual({
      ...ENVELOPE,
      action: 'remove',
      cardName: 'Lightning Bolt',
      board: 'Sideboard',
    })
  })

  test('parses a board suffix alongside printing info and a card ID', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added Sol Ring (MH3:301) [foil] to Sideboard &12
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Sol Ring',
      cardId: 12,
      set: 'mh3',
      collectorNumber: '301',
      finish: 'foil',
      board: 'Sideboard',
    })
  })

  test('does not treat a "to Main" suffix as a board', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added Sol Ring to Main
`
    const { pages } = parseLegacy(content)
    // "Main" is the default board and carries no annotation.
    expect(pages[0]!.changes[0]).toEqual({ ...ENVELOPE, action: 'add', cardName: 'Sol Ring' })
  })

  test('parses quoted card names, stripping the quotes', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added "Demonic Tutor" (UMA:93) [foil]
- Removed "Misty Rainforest"
- Set "Avacyn, Angel of Hope" as commander
- Set "Sol Ring" finish to foil
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Demonic Tutor',
      set: 'uma',
      collectorNumber: '93',
      finish: 'foil',
    })
    expect(pages[0]!.changes[1]).toEqual({
      ...ENVELOPE,
      action: 'remove',
      cardName: 'Misty Rainforest',
    })
    expect(pages[0]!.changes[2]).toEqual({
      ...ENVELOPE,
      action: 'set-commander',
      cardName: 'Avacyn, Angel of Hope',
    })
    expect(pages[0]!.changes[3]).toEqual({
      ...ENVELOPE,
      action: 'set-finish',
      cardName: 'Sol Ring',
      finish: 'foil',
    })
  })

  test('quotes disambiguate a card name that itself contains a board phrase', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added "Welcome to Sideboard" to Maybeboard
`
    const { pages } = parseLegacy(content)
    // The closing quote bounds the name, so "to Sideboard" stays part of it and only
    // the trailing "to Maybeboard" is read as the board.
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Welcome to Sideboard',
      board: 'Maybeboard',
    })
  })

  test('quotes keep parentheses inside the card name out of the printing field', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added "Hazmat Suit (Used)" &5
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Hazmat Suit (Used)',
      cardId: 5,
    })
  })

  test('an unquoted name whose parenthetical is not a SET:CN fails the line rather than losing it', () => {
    // Older unquoted lines bind the `(...)` group as the printing; when it is
    // not one, the line must land in unparsedLines, never as a truncated event.
    for (const line of [
      "- Added Erase (Not the Urza's Legacy One)",
      '- Removed Everythingamajig (b) &2',
      "- Moved B.F.M. (Big Furry Monster) &5 to Deck 'Burn'",
    ]) {
      expect(parseLegacyChangeLine(line)).toBeNull()
    }
    // A trailing real printing still binds as the printing.
    expect(
      parseLegacyChangeLine("- Added Erase (Not the Urza's Legacy One) (ULG:16)"),
    ).toMatchObject({
      cardName: "Erase (Not the Urza's Legacy One)",
      set: 'ulg',
      collectorNumber: '16',
    })
  })

  test('parses quoted "Set note on" and "Cleared note on" lines', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Set note on "Sol Ring" &5 to "starts the engine"
- Cleared note on "Lightning Bolt" &2
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-note',
      cardName: 'Sol Ring',
      cardId: 5,
      note: 'starts the engine',
    })
    expect(pages[0]!.changes[1]).toEqual({
      ...ENVELOPE,
      action: 'set-note',
      note: '',
      cardName: 'Lightning Bolt',
      cardId: 2,
    })
  })

  test('returns pages in most-recent-first order', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Added Mountain

## 2026-02-01T00:00:00Z

- Removed Swamp

## 2026-03-01T00:00:00Z

- Added Forest
`
    const { pages } = parseLegacy(content)
    expect(pages).toHaveLength(3)
    expect(pages[0]!.timestamp).toBe('2026-03-01T00:00:00Z')
    expect(pages[1]!.timestamp).toBe('2026-02-01T00:00:00Z')
    expect(pages[2]!.timestamp).toBe('2026-01-01T00:00:00Z')
  })

  test('handles multiple changes in one entry', () => {
    const content = `# Changelog

## 2026-03-07T12:00:00Z

- Added Lightning Bolt
- Removed Chain Lightning
- Added Counterspell (MH2:267)
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes.map((c) => ('cardName' in c ? c.cardName : ''))).toEqual([
      'Lightning Bolt',
      'Chain Lightning',
      'Counterspell',
    ])
  })

  test('returns empty array for empty content', () => {
    expect(parseLegacy('').pages).toEqual([])
    expect(parseLegacy('# Changelog for Nothing').pages).toEqual([])
  })

  test('skips entries with no changes', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

## 2026-02-01T00:00:00Z

- Added Sol Ring
`
    const { pages } = parseLegacy(content)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.timestamp).toBe('2026-02-01T00:00:00Z')
  })

  test('parses unquoted "Set note on X to Y" and "Cleared note on X" with cardId suffix', () => {
    const content = `# Changelog

## 2026-05-06T00:00:00Z

- Set note on Sol Ring &5 to "starts the engine"
- Cleared note on Sol Ring &5
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'set-note',
      cardName: 'Sol Ring',
      cardId: 5,
      note: 'starts the engine',
    })
    expect(pages[0]!.changes[1]).toEqual({
      ...ENVELOPE,
      action: 'set-note',
      note: '',
      cardName: 'Sol Ring',
      cardId: 5,
    })
  })

  test('parses card with &N card ID suffix', () => {
    const content = `# Changelog

## 2026-04-15T14:22:02.299Z

- Added Elvish Reclaimer (M20:169) &151
- Added Nissa, Ascended Animist (ONE:454) [foil] &152
- Added The Earth Crystal (FIN:184) &153
`
    const { pages } = parseLegacy(content)
    expect(pages[0]!.changes[0]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Elvish Reclaimer',
      cardId: 151,
      set: 'm20',
      collectorNumber: '169',
    })
    expect(pages[0]!.changes[1]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'Nissa, Ascended Animist',
      cardId: 152,
      set: 'one',
      collectorNumber: '454',
      finish: 'foil',
    })
    expect(pages[0]!.changes[2]).toEqual({
      ...ENVELOPE,
      action: 'add',
      cardName: 'The Earth Crystal',
      cardId: 153,
      set: 'fin',
      collectorNumber: '184',
    })
  })
})

describe('parseLegacyChangeLines', () => {
  test('keeps the lines no grammar accepts, verbatim and in order, beside the events', () => {
    const { events, unparsedLines } = parseLegacyChangeLines([
      '- Added "Sol Ring" &1',
      '- Frobnicated "Sol Ring" &1',
      '- Set language of "Sol Ring" to Klingon &1',
      '- Removed "Sol Ring" &1',
    ])
    expect(events.map((e) => e.action)).toEqual(['add', 'remove'])
    expect(unparsedLines).toEqual([
      '- Frobnicated "Sol Ring" &1',
      '- Set language of "Sol Ring" to Klingon &1',
    ])
  })

  test('parseLegacyChangeLine returns null for a line no grammar accepts', () => {
    expect(parseLegacyChangeLine('- something freeform')).toBeNull()
    expect(parseLegacyChangeLine('not even a change line')).toBeNull()
  })
})
