import { describe, expect, test } from 'bun:test'
import { buildExportFileName, type ExportFileNameInput } from '../../src/export/file'
import type { ListLocation } from '../../src/resolve-list'

/**
 * The server-chosen filename for `POST /api/export` with `write: true`. Pure by
 * design: the name is a function of the request plus the directory's existing
 * contents, so it never overwrites and never needs a clock read at call sites.
 */

// 23:45Z is already the 29th east of UTC, so on such a host these names would
// also catch a local-date implementation. That is a property of the fixture, not
// a pinned guarantee — a UTC or US-offset CI box would not catch it. There is
// deliberately no TZ-lever test: the only lever is process.env.TZ, and mutating
// it leaks across this single-process suite.
const NOW = new Date('2026-07-28T23:45:00Z')

function list(name: string): ListLocation {
  return { type: 'collection', name, filePath: `/tmp/collections/${name}.md` }
}

function nameFor(overrides: Partial<ExportFileNameInput> = {}): string {
  return buildExportFileName({
    lists: [],
    hasCardPicks: false,
    format: 'csv',
    now: NOW,
    existing: new Set(),
    ...overrides,
  })
}

describe('buildExportFileName', () => {
  test('one selected list names the file after it', () => {
    expect(nameFor({ lists: [list('Binder')] })).toBe('Binder-20260728.csv')
  })

  test('a list name with filesystem-illegal characters is sanitized', () => {
    expect(nameFor({ lists: [list('Trades: 2026/Q3')] })).toBe('Trades 2026Q3-20260728.csv')
  })

  test('a card-pick-only export is named for the picks', () => {
    expect(nameFor({ hasCardPicks: true })).toBe('cards-20260728.csv')
  })

  test('several lists, or none, fall back to all-lists', () => {
    expect(nameFor({ lists: [list('Binder'), list('Trades')] })).toBe('all-lists-20260728.csv')
    expect(nameFor()).toBe('all-lists-20260728.csv')
  })

  test('a single list combined with card picks is not named for that list alone', () => {
    expect(nameFor({ lists: [list('Binder')], hasCardPicks: true })).toBe('all-lists-20260728.csv')
  })

  test.each([
    ['csv', 'all-lists-20260728.csv'],
    ['json', 'all-lists-20260728.json'],
    ['text', 'all-lists-20260728.txt'],
    ['md', 'all-lists-20260728.md'],
  ] as const)('the %s format writes %s', (format, expected) => {
    expect(nameFor({ format })).toBe(expected)
  })

  test('a taken name walks the -N suffixes instead of overwriting', () => {
    const existing = new Set(['all-lists-20260728.csv', 'all-lists-20260728-2.csv'])
    expect(nameFor({ existing })).toBe('all-lists-20260728-3.csv')
  })
})
