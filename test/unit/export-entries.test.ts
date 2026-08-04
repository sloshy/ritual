import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import {
  exportEntryKey,
  filterExportEntries,
  hasActiveExportFilters,
  loadExportEntries,
  parseConditionFilterValues,
  parseLabelFilterValues,
  type ExportEntry,
} from '../../src/export/entries'
import type { ListLocation } from '../../src/resolve-list'

function entry(overrides: Partial<ExportEntry> = {}): ExportEntry {
  return {
    listType: 'collection',
    listName: 'Binder',
    section: 'Main',
    name: 'Lightning Bolt',
    quantity: 1,
    set: 'lea',
    collectorNumber: '161',
    fileOrder: 0,
    ...overrides,
  }
}

async function withListFile<T>(
  type: ListLocation['type'],
  content: string,
  run: (location: ListLocation) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-export-test-'))
  try {
    const filePath = path.join(dir, 'Test List.md')
    await fs.writeFile(filePath, content)
    return await run({ type, name: 'Test List', filePath })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('loadExportEntries', () => {
  test('flattens a deck keeping condition, note, and section, dropping card IDs', async () => {
    const content = [
      '# Main',
      '2 Sol Ring (C21:263) [foil] [NM] {trade bait} &3',
      '# Maybeboard',
      '1 Counterspell &7',
    ].join('\n')
    const { entries, warnings } = await withListFile('deck', content, (location) =>
      loadExportEntries([location]),
    )
    expect(warnings).toEqual([])
    expect(entries).toEqual([
      {
        listType: 'deck',
        listName: 'Test List',
        section: 'Main',
        name: 'Sol Ring',
        quantity: 2,
        set: 'c21',
        collectorNumber: '263',
        finish: 'foil',
        condition: 'NM',
        note: 'trade bait',
        fileOrder: 0,
      },
      {
        listType: 'deck',
        listName: 'Test List',
        section: 'Maybeboard',
        name: 'Counterspell',
        quantity: 1,
        set: undefined,
        collectorNumber: undefined,
        finish: undefined,
        condition: undefined,
        note: undefined,
        fileOrder: 1,
      },
    ])
  })

  test('flattens a collection with lowercase set codes and per-line quantity 1', async () => {
    const content = ['## Trades', '- Mana Crypt (2XM:1) [etched] [LP]'].join('\n')
    const { entries } = await withListFile('collection', content, (location) =>
      loadExportEntries([location]),
    )
    expect(entries).toEqual([
      {
        listType: 'collection',
        listName: 'Test List',
        section: 'Trades',
        name: 'Mana Crypt',
        quantity: 1,
        set: '2xm',
        collectorNumber: '1',
        finish: 'etched',
        condition: 'LP',
        note: undefined,
        fileOrder: 0,
      },
    ])
  })

  test('flattens wanted entries without a condition, allowing name-only lines', async () => {
    const content = ['- Brainstorm', '- Ponder (m12:65) [foil]'].join('\n')
    const { entries } = await withListFile('wanted', content, (location) =>
      loadExportEntries([location]),
    )
    expect(entries.map((e) => e.name)).toEqual(['Brainstorm', 'Ponder'])
    expect(entries[0]!.set).toBeUndefined()
    expect(entries[1]!).toMatchObject({ set: 'm12', finish: 'foil', condition: undefined })
    expect(entries.map((e) => e.fileOrder)).toEqual([0, 1])
  })

  test('collects parse warnings prefixed with the list name', async () => {
    const content = '- Lightning Bolt'
    const { entries, warnings } = await withListFile('collection', content, (location) =>
      loadExportEntries([location]),
    )
    expect(entries).toEqual([])
    expect(warnings).toEqual([
      "Test List: Skipping 'Lightning Bolt': missing set code and collector number",
    ])
  })
})

describe('exportEntryKey', () => {
  test('distinguishes entries by list identity and file order', () => {
    expect(exportEntryKey(entry())).toBe('collection|Binder|0')
    expect(exportEntryKey(entry({ fileOrder: 3 }))).toBe('collection|Binder|3')
    expect(exportEntryKey(entry({ listType: 'deck' }))).not.toBe(exportEntryKey(entry()))
  })
})

describe('filterExportEntries', () => {
  const entries = [
    entry({ name: 'Lightning Bolt', set: 'lea', finish: undefined, condition: 'NM' }),
    entry({ name: 'Lightning Bolt', set: 'sta', finish: 'foil', condition: 'LP', fileOrder: 1 }),
    entry({ name: 'Sol Ring', set: 'c21', finish: 'etched', condition: undefined, fileOrder: 2 }),
  ]

  test('name filter requires every term to match', () => {
    expect(filterExportEntries(entries, { name: 'light bolt' })).toHaveLength(2)
    expect(filterExportEntries(entries, { name: 'bolt ring' })).toHaveLength(0)
  })

  test('set filter is case-insensitive exact', () => {
    expect(filterExportEntries(entries, { set: 'LEA' })).toHaveLength(1)
    expect(filterExportEntries(entries, { set: 'le' })).toHaveLength(0)
  })

  test('nonfoil finish matches entries with no explicit finish', () => {
    expect(filterExportEntries(entries, { finish: 'nonfoil' })).toEqual([entries[0]!])
    expect(filterExportEntries(entries, { finish: 'foil' })).toEqual([entries[1]!])
  })

  test('an explicit condition grade matches only entries with it marked', () => {
    expect(filterExportEntries(entries, { conditions: ['NM'] })).toEqual([entries[0]!])
    expect(filterExportEntries(entries, { conditions: ['MP'] })).toEqual([])
  })

  test("'none' matches entries without a condition, and combines with grades", () => {
    expect(filterExportEntries(entries, { conditions: ['none'] })).toEqual([entries[2]!])
    expect(filterExportEntries(entries, { conditions: ['NM', 'none'] })).toEqual([
      entries[0]!,
      entries[2]!,
    ])
  })

  test('wanted entries never match a condition filter', () => {
    const wanted = entry({ listType: 'wanted', condition: undefined })
    expect(filterExportEntries([wanted], { conditions: ['NM'] })).toEqual([])
    expect(filterExportEntries([wanted], { conditions: ['none'] })).toEqual([])
  })

  test('filters compose with AND semantics', () => {
    expect(filterExportEntries(entries, { name: 'bolt', finish: 'foil' })).toEqual([entries[1]!])
  })

  test('hasActiveExportFilters reflects any present filter', () => {
    expect(hasActiveExportFilters({})).toBe(false)
    expect(hasActiveExportFilters({ set: 'lea' })).toBe(true)
    expect(hasActiveExportFilters({ conditions: [] })).toBe(false)
    expect(hasActiveExportFilters({ conditions: ['none'] })).toBe(true)
  })
})

describe('parseConditionFilterValues', () => {
  test('parses grades case-insensitively plus none, deduplicating', () => {
    expect(parseConditionFilterValues(['nm', 'NONE', 'NM'])).toEqual(['NM', 'none'])
  })

  test('rejects unknown values and empty input with an error string', () => {
    expect(parseConditionFilterValues(['OK'])).toContain("Invalid condition 'OK'")
    expect(parseConditionFilterValues([])).toContain('No conditions given')
  })
})

describe('labels filter', () => {
  const labeled = [
    entry({ name: 'Sale Card', labels: ['sale'] }),
    entry({ name: 'Both Card', labels: ['sale', 'trade'], fileOrder: 1 }),
    entry({ name: 'Keep Card', labels: ['keep'], fileOrder: 2 }),
    entry({ name: 'Plain Card', fileOrder: 3 }),
    entry({ name: 'Deck Card', listType: 'deck', labels: undefined, fileOrder: 4 }),
  ]

  test('matches effective labels with OR semantics', () => {
    const result = filterExportEntries(labeled, { labels: ['sale', 'trade'] })
    expect(result.map((e) => e.name)).toEqual(['Sale Card', 'Both Card'])
  })

  test("'none' matches unlabeled collection entries only", () => {
    const result = filterExportEntries(labeled, { labels: ['none'] })
    expect(result.map((e) => e.name)).toEqual(['Plain Card'])
  })

  test('a labels filter may combine keep with the others (it selects, not declares)', () => {
    const result = filterExportEntries(labeled, { labels: ['keep', 'none'] })
    expect(result.map((e) => e.name)).toEqual(['Keep Card', 'Plain Card'])
  })

  test('deck and wanted entries never match a labels filter', () => {
    const result = filterExportEntries(labeled, { labels: ['sale', 'trade', 'keep', 'none'] })
    // Positive form: exactly the collection entries survive — 'Deck Card' is out
    // even though 'none' matches every unlabeled collection entry.
    expect(result.map((e) => e.name)).toEqual(['Sale Card', 'Both Card', 'Keep Card', 'Plain Card'])
  })

  test('counts as an active filter', () => {
    expect(hasActiveExportFilters({ labels: ['sale'] })).toBe(true)
    expect(hasActiveExportFilters({ labels: [] })).toBe(false)
  })

  test('the collection loader resolves effective labels from the file', async () => {
    const content =
      '---\nlabels: [sale]\n---\n\n# Test List\n\n- Sol Ring (C21:263) [keep] &1\n- Lightning Bolt (LEA:161) &2\n'
    await withListFile('collection', content, async (location) => {
      const { entries: loaded } = await loadExportEntries([location])
      expect(loaded[0]!.labels).toEqual(['keep'])
      expect(loaded[1]!.labels).toEqual(['sale'])
    })
  })
})

describe('parseLabelFilterValues', () => {
  test('parses case-insensitively, deduping', () => {
    expect(parseLabelFilterValues(['SALE', 'sale', 'None'])).toEqual(['sale', 'none'])
  })

  test('rejects unknown values and empty lists with the vocabulary named', () => {
    expect(parseLabelFilterValues(['sell'])).toContain("Invalid label 'sell'")
    expect(parseLabelFilterValues([])).toContain('No labels given')
  })
})
