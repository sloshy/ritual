import { describe, test, expect } from 'bun:test'
import { parseChangelog, extractChangelogCardNames } from '../../src/changes/changelog-parser'

describe('parseChangelog', () => {
  test('parses a simple changelog with one entry', () => {
    const content = `# Changelog for Test Deck

## 2026-03-07T22:01:21.452Z

- Removed Misty Rainforest
`
    const pages = parseChangelog(content)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.timestamp).toBe('2026-03-07T22:01:21.452Z')
    expect(pages[0]!.changes).toHaveLength(1)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Removed',
      cardName: 'Misty Rainforest',
    })
  })

  test('parses added card with set:collectorNumber', () => {
    const content = `# Changelog

## 2026-03-07T00:00:00Z

- Added Demonic Tutor (UMA:93)
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Added',
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
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Added',
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
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set as commander',
      cardName: 'Avacyn, Angel of Hope',
    })
  })

  test('parses "Unset X as commander"', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Unset Avacyn, Angel of Hope as commander
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Unset as commander',
      cardName: 'Avacyn, Angel of Hope',
    })
  })

  test('parses "Set X finish to foil"', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set Sol Ring finish to foil
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set finish',
      cardName: 'Sol Ring',
      finish: 'foil',
    })
  })

  test('parses "Set X printing to SET:CN [finish]"', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set "Lightning Bolt" printing to M10:146 [foil] &5
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set printing',
      cardName: 'Lightning Bolt',
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
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set printing',
      cardName: 'Lightning Bolt',
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
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set printing',
      cardName: 'Lightning Bolt',
    })
  })

  test('parses "Set language of X to <name>" into the language code', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set language of "Sol Ring" to Japanese &5
- Set language of "Sol Ring" to Simplified Chinese
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set language',
      cardName: 'Sol Ring',
      language: 'ja',
    })
    // Multi-word display names parse too — the &N-less form as well.
    expect(pages[0]!.changes[1]).toEqual({
      action: 'Set language',
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
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set language',
      cardName: 'Ashes to Ashes',
      language: 'ja',
    })
  })

  test('drops a "Set language" line naming no known language', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set language of "Sol Ring" to Klingon &5
`
    const pages = parseChangelog(content)
    expect(pages).toHaveLength(0)
  })

  test('classifies a [ja] bracket on add/remove lines as the language', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Added "Ambition's Cost" (NEO:234) [foil] [LP] [ja] &7
- Removed "Sol Ring" [ja]
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Added',
      cardName: "Ambition's Cost",
      set: 'neo',
      collectorNumber: '234',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
    })
    expect(pages[0]!.changes[1]).toEqual({
      action: 'Removed',
      cardName: 'Sol Ring',
      language: 'ja',
    })
  })

  test('parses a [ja] token inside a set-printing descriptor', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Set "Lightning Bolt" printing to M10:146 [foil] [ja] &5
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set printing',
      cardName: 'Lightning Bolt',
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
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Added',
      cardName: 'Cavern-Hoard Dragon',
      board: 'Maybeboard',
    })
    expect(pages[0]!.changes[1]).toEqual({
      action: 'Removed',
      cardName: 'Lightning Bolt',
      board: 'Sideboard',
    })
  })

  test('parses a board suffix alongside printing info and a card ID', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added Sol Ring (MH3:301) [foil] to Sideboard &12
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Added',
      cardName: 'Sol Ring',
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
    const pages = parseChangelog(content)
    // "Main" is the default board and carries no annotation.
    expect(pages[0]!.changes[0]!.cardName).toBe('Sol Ring')
    expect(pages[0]!.changes[0]!.board).toBeUndefined()
  })

  test('parses quoted card names, stripping the quotes', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added "Demonic Tutor" (UMA:93) [foil]
- Removed "Misty Rainforest"
- Set "Avacyn, Angel of Hope" as commander
- Set "Sol Ring" finish to foil
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Added',
      cardName: 'Demonic Tutor',
      set: 'uma',
      collectorNumber: '93',
      finish: 'foil',
    })
    expect(pages[0]!.changes[1]).toEqual({ action: 'Removed', cardName: 'Misty Rainforest' })
    expect(pages[0]!.changes[2]).toEqual({
      action: 'Set as commander',
      cardName: 'Avacyn, Angel of Hope',
    })
    expect(pages[0]!.changes[3]).toEqual({
      action: 'Set finish',
      cardName: 'Sol Ring',
      finish: 'foil',
    })
  })

  test('quotes disambiguate a card name that itself contains a board phrase', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added "Welcome to Sideboard" to Maybeboard
`
    const pages = parseChangelog(content)
    // The closing quote bounds the name, so "to Sideboard" stays part of it and only
    // the trailing "to Maybeboard" is read as the board.
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Added',
      cardName: 'Welcome to Sideboard',
      board: 'Maybeboard',
    })
  })

  test('quotes keep parentheses inside the card name out of the printing field', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Added "Hazmat Suit (Used)" &5
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({ action: 'Added', cardName: 'Hazmat Suit (Used)' })
  })

  test('parses quoted "Set note on" and "Cleared note on" lines', () => {
    const content = `# Changelog

## 2026-05-08T00:00:00Z

- Set note on "Sol Ring" &5 to "starts the engine"
- Cleared note on "Lightning Bolt" &2
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set note',
      cardName: 'Sol Ring',
      note: 'starts the engine',
    })
    expect(pages[0]!.changes[1]).toEqual({ action: 'Cleared note', cardName: 'Lightning Bolt' })
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
    const pages = parseChangelog(content)
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
    const pages = parseChangelog(content)
    expect(pages[0]!.changes).toHaveLength(3)
    expect(pages[0]!.changes[0]!.cardName).toBe('Lightning Bolt')
    expect(pages[0]!.changes[1]!.cardName).toBe('Chain Lightning')
    expect(pages[0]!.changes[2]!.cardName).toBe('Counterspell')
  })

  test('returns empty array for empty content', () => {
    expect(parseChangelog('')).toEqual([])
    expect(parseChangelog('# Changelog for Nothing')).toEqual([])
  })

  test('skips entries with no changes', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

## 2026-02-01T00:00:00Z

- Added Sol Ring
`
    const pages = parseChangelog(content)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.timestamp).toBe('2026-02-01T00:00:00Z')
  })

  test('parses unquoted "Set note on X to Y" and "Cleared note on X" with cardId suffix', () => {
    const content = `# Changelog

## 2026-05-06T00:00:00Z

- Set note on Sol Ring &5 to "starts the engine"
- Cleared note on Sol Ring &5
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Set note',
      cardName: 'Sol Ring',
      note: 'starts the engine',
    })
    expect(pages[0]!.changes[1]).toEqual({
      action: 'Cleared note',
      cardName: 'Sol Ring',
    })
  })

  test('parses card with &N card ID suffix', () => {
    const content = `# Changelog

## 2026-04-15T14:22:02.299Z

- Added Elvish Reclaimer (M20:169) &151
- Added Nissa, Ascended Animist (ONE:454) [foil] &152
- Added The Earth Crystal (FIN:184) &153
`
    const pages = parseChangelog(content)
    expect(pages[0]!.changes[0]).toEqual({
      action: 'Added',
      cardName: 'Elvish Reclaimer',
      set: 'm20',
      collectorNumber: '169',
    })
    expect(pages[0]!.changes[1]).toEqual({
      action: 'Added',
      cardName: 'Nissa, Ascended Animist',
      set: 'one',
      collectorNumber: '454',
      finish: 'foil',
    })
    expect(pages[0]!.changes[2]).toEqual({
      action: 'Added',
      cardName: 'The Earth Crystal',
      set: 'fin',
      collectorNumber: '184',
    })
  })
})

describe('extractChangelogCardNames', () => {
  test('extracts unique card names across all pages', () => {
    const content = `# Changelog

## 2026-01-01T00:00:00Z

- Added Sol Ring
- Removed Lightning Bolt

## 2026-02-01T00:00:00Z

- Added Sol Ring (MH3:301)
- Added Demonic Tutor
`
    const pages = parseChangelog(content)
    const names = extractChangelogCardNames(pages)
    expect(names).toContain('Sol Ring')
    expect(names).toContain('Lightning Bolt')
    expect(names).toContain('Demonic Tutor')
    // Sol Ring appears twice but should only be in the list once
    expect(names.filter((n) => n === 'Sol Ring')).toHaveLength(1)
  })
})
