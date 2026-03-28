import { describe, test, expect } from 'bun:test'
import { parseChangelog, extractChangelogCardNames } from '../../src/changelog-parser'

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
