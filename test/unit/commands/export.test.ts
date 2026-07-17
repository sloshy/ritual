import { describe, expect, test } from 'bun:test'
import { shouldRunExportInteractive, type ParsedExportFlags } from '../../../src/commands/export'
import { assembleExportEntries } from '../../../src/export/entries'
import {
  assembledWizardEntries,
  buildWizardMenuChoices,
  formatExportEntryChoice,
  formatFiltersSegment,
  formatPresetSummary,
  formatWizardHeaderLines,
  type ExportWizardState,
} from '../../../src/commands/export-wizard'
import type { ExportEntry } from '../../../src/export/entries'
import { DEFAULT_EXPORT_COLUMNS } from '../../../src/export/render'
import type { ExportWizardSelection } from '../../../src/commands/export-wizard'

function flags(overrides: Partial<ParsedExportFlags> = {}): ParsedExportFlags {
  return {
    all: false,
    cards: [],
    filters: {},
    interactive: true,
    ...overrides,
  }
}

function entry(overrides: Partial<ExportEntry> = {}): ExportEntry {
  return {
    listType: 'deck',
    listName: 'Burn',
    section: 'Main',
    name: 'Lightning Bolt',
    quantity: 1,
    set: 'lea',
    collectorNumber: '161',
    fileOrder: 0,
    ...overrides,
  }
}

function wizardState(overrides: Partial<ExportWizardState> = {}): ExportWizardState {
  return {
    lists: [],
    picked: [],
    filters: {},
    settings: { format: 'csv', columns: DEFAULT_EXPORT_COLUMNS, header: true, quoteAll: false },
    ...overrides,
  }
}

describe('shouldRunExportInteractive', () => {
  test('interactive for a bare TTY invocation', () => {
    expect(shouldRunExportInteractive(flags(), [], true)).toBe(true)
  })

  test('interactive with only --preset', () => {
    expect(shouldRunExportInteractive(flags({ preset: 'deckbox' }), [], true)).toBe(true)
  })

  test.each<[string, ParsedExportFlags, string[], boolean]>([
    ['stdout is not a TTY', flags(), [], false],
    ['list args', flags(), ['Burn'], true],
    ['--all', flags({ all: true }), [], true],
    ['--card', flags({ cards: ['bolt'] }), [], true],
    ['--format', flags({ format: 'json' }), [], true],
    ['--columns', flags({ columns: ['name'] }), [], true],
    ['--no-header', flags({ header: false }), [], true],
    ['--quote-all', flags({ quoteAll: true }), [], true],
    ['--out', flags({ out: 'x.csv' }), [], true],
    ['--save-preset', flags({ savePreset: 'p' }), [], true],
    ['a name filter', flags({ filters: { name: 'bolt' } }), [], true],
    ['a finish filter', flags({ filters: { finish: 'foil' } }), [], true],
    ['--no-interactive', flags({ interactive: false }), [], true],
  ])('flag mode when %s is present', (_label, input, listArgs, isTTY) => {
    expect(shouldRunExportInteractive(input, listArgs, isTTY)).toBe(false)
  })
})

describe('assembleExportEntries', () => {
  const burn = [entry(), entry({ name: 'Fireblast', fileOrder: 1 })]
  const scope = [
    ...burn,
    entry({ listName: 'Binder', listType: 'collection', name: 'Sol Ring', fileOrder: 0 }),
  ]

  test('card picks add matching entries from the scope, deduped against lists', () => {
    const { entries, unmatchedTerms } = assembleExportEntries(burn, scope, ['bolt', 'sol ring'])
    expect(entries.map((e) => e.name)).toEqual(['Lightning Bolt', 'Fireblast', 'Sol Ring'])
    expect(unmatchedTerms).toEqual([])
  })

  test('reports terms that matched nothing', () => {
    const { entries, unmatchedTerms } = assembleExportEntries([], scope, ['black lotus'])
    expect(entries).toEqual([])
    expect(unmatchedTerms).toEqual(['black lotus'])
  })
})

describe('wizard pure builders', () => {
  test('assembledWizardEntries unions selected lists and picks, then filters', () => {
    const all = [
      entry(),
      entry({ name: 'Fireblast', fileOrder: 1 }),
      entry({ listType: 'collection', listName: 'Binder', name: 'Sol Ring', set: 'c21' }),
    ]
    const state = wizardState({
      lists: [{ type: 'deck', name: 'Burn', filePath: '/x/Burn.md' }],
      picked: [all[0]!, all[2]!],
      filters: { set: 'lea' },
    })
    const assembled = assembledWizardEntries(state, all)
    // Burn's two entries, the duplicate Bolt pick deduped, the C21 Sol Ring
    // pick dropped by the LEA set filter.
    expect(assembled.map((e) => e.name)).toEqual(['Lightning Bolt', 'Fireblast'])
  })

  test('formatExportEntryChoice shows qty, printing, finish, condition, and source', () => {
    const line = formatExportEntryChoice(
      entry({ quantity: 2, finish: 'foil', condition: 'NM', section: 'Sideboard' }),
    )
    expect(line).toContain('2x Lightning Bolt (LEA:161) [foil] [NM]')
    expect(line).toContain('Burn / Sideboard')
  })

  test('formatFiltersSegment summarizes active filters', () => {
    expect(formatFiltersSegment({})).toBe('none')
    expect(
      formatFiltersSegment({ name: 'sol', set: 'c21', finish: 'foil', conditions: ['NM', 'none'] }),
    ).toBe('name "sol" · set C21 · foil · NM/none')
  })

  test('formatWizardHeaderLines includes CSV options only for csv', () => {
    const csvLines = formatWizardHeaderLines(wizardState(), 0)
    expect(csvLines.some((line) => line.startsWith('CSV:'))).toBe(true)
    const jsonLines = formatWizardHeaderLines(
      wizardState({
        settings: { format: 'json', columns: ['name'], header: true, quoteAll: false },
      }),
      0,
    )
    expect(jsonLines.some((line) => line.startsWith('CSV:'))).toBe(false)
  })

  const menuKinds = (state: ExportWizardState, presetCount: number): string[] =>
    buildWizardMenuChoices(state, 0, presetCount).map(
      (choice) => (choice.value as ExportWizardSelection).kind,
    )

  test('buildWizardMenuChoices hides CSV options for json and load-preset without presets', () => {
    const csvWithoutPresets = menuKinds(wizardState(), 0)
    expect(csvWithoutPresets).toContain('csv-options')
    expect(csvWithoutPresets).not.toContain('load-preset')
    const json = wizardState({
      settings: { format: 'json', columns: ['name'], header: true, quoteAll: false },
    })
    const jsonWithPresets = menuKinds(json, 2)
    expect(jsonWithPresets).not.toContain('csv-options')
    expect(jsonWithPresets).toContain('load-preset')
  })

  test('the menu reads as the export pipeline, with load-preset above what it overwrites', () => {
    // A preset carries the format, columns, and CSV options, so it must be
    // offered before them — not after, where it would silently discard settings
    // the user had just made by hand.
    expect(menuKinds(wizardState(), 2)).toEqual([
      'add-lists',
      'add-cards',
      'filters',
      'load-preset',
      'format',
      'columns',
      'csv-options',
      'save-preset',
      'review',
      'export',
      'exit',
    ])
  })

  test('formatPresetSummary lists the shape compactly', () => {
    expect(
      formatPresetSummary('deckbox', {
        format: 'csv',
        columns: ['name', 'quantity'],
        header: false,
        quoteAll: true,
      }),
    ).toBe('deckbox — CSV · Name, Quantity · no header · quote all')
  })
})
