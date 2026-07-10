import { describe, expect, test } from 'bun:test'
import {
  convertCsvRows,
  formatColumnsSpec,
  guessColumns,
  guessHasHeader,
  normalizeCondition,
  normalizeFinish,
  normalizeQuantity,
  normalizeSection,
  parseColumnsSpec,
  parseCsv,
  validateMapping,
  type ColumnMapping,
  type CsvRow,
} from '../../src/importers/csv'
import { formatScriptingCommand } from '../../src/commands/import-csv'
import type { Condition, Finish } from '../../src/types'

function rowsOf(result: ReturnType<typeof parseCsv>): CsvRow[] {
  if ('error' in result) throw new Error(`Unexpected parse error: ${result.error}`)
  return result.rows
}

describe('parseCsv', () => {
  test('parses plain rows with line numbers', () => {
    const rows = rowsOf(parseCsv('a,b,c\nd,e,f\n'))
    expect(rows).toEqual([
      { cells: ['a', 'b', 'c'], lineNumber: 1, raw: 'a,b,c' },
      { cells: ['d', 'e', 'f'], lineNumber: 2, raw: 'd,e,f' },
    ])
  })

  test('handles quoted fields with commas and escaped quotes', () => {
    const rows = rowsOf(parseCsv('"Jace, the Mind Sculptor",WWK\n"He said ""hi""",X\n'))
    expect(rows[0]!.cells).toEqual(['Jace, the Mind Sculptor', 'WWK'])
    expect(rows[1]!.cells).toEqual(['He said "hi"', 'X'])
  })

  test('tracks line numbers across embedded newlines in quoted fields', () => {
    const rows = rowsOf(parseCsv('"two\nlines",a\nnext,b\n'))
    expect(rows[0]!.cells).toEqual(['two\nlines', 'a'])
    expect(rows[0]!.lineNumber).toBe(1)
    expect(rows[1]!.lineNumber).toBe(3)
  })

  test('handles CRLF line endings and skips blank lines', () => {
    const rows = rowsOf(parseCsv('a,b\r\n\r\nc,d\r\n'))
    expect(rows).toHaveLength(2)
    expect(rows[0]!.cells).toEqual(['a', 'b'])
    expect(rows[1]!.cells).toEqual(['c', 'd'])
    expect(rows[1]!.lineNumber).toBe(3)
  })

  test('parses a final row without a trailing newline', () => {
    const rows = rowsOf(parseCsv('a,b\nc,d'))
    expect(rows).toHaveLength(2)
    expect(rows[1]!.cells).toEqual(['c', 'd'])
  })

  test('reports an unterminated quoted field with its starting line', () => {
    const result = parseCsv('a,b\nc,"unclosed\nstill going')
    expect(result).toEqual({ error: 'Unterminated quoted field starting on line 2' })
  })
})

describe('parseColumnsSpec', () => {
  test('parses a 1-based spec into a 0-based mapping', () => {
    const mapping = parseColumnsSpec('name=1,set=2,collector-number=3,quantity=6', 'collection')
    expect(mapping).toEqual({ name: 0, set: 1, collectorNumber: 2, quantity: 5 })
  })

  test('rejects unknown fields', () => {
    expect(parseColumnsSpec('name=1,rarity=2', 'deck')).toMatch(/Unknown field 'rarity'/)
  })

  test('rejects duplicate fields and missing name', () => {
    expect(parseColumnsSpec('name=1,name=2', 'deck')).toMatch(/mapped more than once/)
    expect(parseColumnsSpec('set=1', 'deck')).toMatch(/Missing required field 'name'/)
  })

  test('rejects non-numeric and zero column numbers', () => {
    expect(parseColumnsSpec('name=first', 'deck')).toMatch(/Invalid column number/)
    expect(parseColumnsSpec('name=0', 'deck')).toMatch(/Invalid column number/)
  })

  test('requires set and collector-number for collections', () => {
    expect(parseColumnsSpec('name=1', 'collection')).toMatch(/require both a set and a collector/)
  })
})

describe('formatColumnsSpec', () => {
  test('round-trips a mapping back to the 1-based flag value', () => {
    const mapping = parseColumnsSpec('name=2,set=1,finish=4,quantity=3', 'deck') as ColumnMapping
    expect(formatColumnsSpec(mapping)).toBe('name=2,set=1,finish=4,quantity=3')
  })
})

describe('formatScriptingCommand', () => {
  test('reproduces the wizard answers', () => {
    const mapping = parseColumnsSpec(
      'name=1,set=2,collector-number=3,quantity=4',
      'collection',
    ) as ColumnMapping
    expect(
      formatScriptingCommand(
        'My Cards.csv',
        'collection',
        'Red Binder',
        'create',
        undefined,
        mapping,
        true,
      ),
    ).toBe(
      "ritual import-csv 'My Cards.csv' --type collection --name 'Red Binder' --columns name=1,set=2,collector-number=3,quantity=4",
    )
    expect(
      formatScriptingCommand('deck.csv', 'deck', 'Burn', 'create', 'modern', mapping, false),
    ).toBe(
      'ritual import-csv deck.csv --type deck --name Burn --format modern --columns name=1,set=2,collector-number=3,quantity=4 --no-header',
    )
    expect(
      formatScriptingCommand('more.csv', 'wanted', 'To Buy', 'append', undefined, mapping, true),
    ).toBe(
      "ritual import-csv more.csv --type wanted --name 'To Buy' --append --columns name=1,set=2,collector-number=3,quantity=4",
    )
    expect(
      formatScriptingCommand('deck.csv', 'deck', 'Burn', 'overwrite', 'modern', mapping, true),
    ).toBe(
      'ritual import-csv deck.csv --type deck --name Burn --overwrite --format modern --columns name=1,set=2,collector-number=3,quantity=4',
    )
  })
})

describe('validateMapping', () => {
  test('accepts a deck mapping with only a name column', () => {
    expect(validateMapping({ name: 0 }, 'deck')).toBeNull()
  })

  test('requires a printing for collections', () => {
    expect(validateMapping({ name: 0, set: 1 }, 'collection')).toMatch(
      /require both a set and a collector/,
    )
  })

  test('rejects a condition column for wanted lists', () => {
    expect(validateMapping({ name: 0, condition: 1 }, 'wanted')).toMatch(/do not track condition/)
  })

  test('rejects two fields mapped to the same column', () => {
    expect(validateMapping({ name: 0, finish: 0 }, 'deck')).toMatch(/same column 1/)
  })
})

describe('normalizeCondition', () => {
  test.each([
    ['NM', 'NM'],
    ['nm', 'NM'],
    ['Near Mint', 'NM'],
    ['near-mint', 'NM'],
    ['Mint', 'NM'],
    ['N', 'NM'],
    ['M', 'NM'],
    ['L', 'LP'],
    ['Lightly Played', 'LP'],
    ['Moderately Played', 'MP'],
    ['Played', 'MP'],
    ['H', 'HP'],
    ['Heavily Played', 'HP'],
    ['D', 'DMG'],
    ['Damaged', 'DMG'],
    ['Poor', 'DMG'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCondition(input)).toEqual({ ok: true, value: expected as Condition })
  })

  test('treats an empty cell as no condition', () => {
    expect(normalizeCondition('')).toEqual({ ok: true, value: undefined })
    expect(normalizeCondition('  ')).toEqual({ ok: true, value: undefined })
  })

  test('rejects unrecognized values', () => {
    expect(normalizeCondition('shiny')).toEqual({
      ok: false,
      error: "Unrecognized condition 'shiny'",
    })
  })
})

describe('normalizeFinish', () => {
  test.each([
    ['F', 'foil'],
    ['foil', 'foil'],
    ['FOIL', 'foil'],
    ['E', 'etched'],
    ['Etched', 'etched'],
    ['etched foil', 'etched'],
    ['foil etched', 'etched'],
    ['yes', 'foil'],
    ['TRUE', 'foil'],
    ['1', 'foil'],
    ['non-foil', 'nonfoil'],
    ['nonfoil', 'nonfoil'],
    ['Normal', 'nonfoil'],
    ['regular', 'nonfoil'],
    ['no', 'nonfoil'],
    ['false', 'nonfoil'],
    ['0', 'nonfoil'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeFinish(input)).toEqual({ ok: true, value: expected as Finish })
  })

  test('treats an empty cell as unspecified (non-foil)', () => {
    expect(normalizeFinish('')).toEqual({ ok: true, value: undefined })
  })

  test('rejects unrecognized values', () => {
    expect(normalizeFinish('glossy')).toEqual({ ok: false, error: "Unrecognized finish 'glossy'" })
  })
})

describe('normalizeSection', () => {
  test('defaults a blank cell to Main', () => {
    expect(normalizeSection('', 'deck')).toBe('Main')
    expect(normalizeSection('  ', 'collection')).toBe('Main')
  })

  test('normalizes deck board aliases to canonical headers', () => {
    expect(normalizeSection('side', 'deck')).toBe('Sideboard')
    expect(normalizeSection('Sideboard', 'deck')).toBe('Sideboard')
    expect(normalizeSection('maybe', 'deck')).toBe('Maybeboard')
    expect(normalizeSection('MAYBEBOARD', 'deck')).toBe('Maybeboard')
    expect(normalizeSection('mainboard', 'deck')).toBe('Main')
    expect(normalizeSection('Command Zone', 'deck')).toBe('Commander')
  })

  test('keeps custom deck sections verbatim', () => {
    expect(normalizeSection('Ramp Package', 'deck')).toBe('Ramp Package')
  })

  test('does not apply board aliases to flat lists', () => {
    expect(normalizeSection('side', 'collection')).toBe('side')
    expect(normalizeSection('Trade Binder', 'wanted')).toBe('Trade Binder')
  })
})

describe('normalizeQuantity', () => {
  test('parses plain and x-suffixed quantities', () => {
    expect(normalizeQuantity('4')).toEqual({ ok: true, value: 4 })
    expect(normalizeQuantity('4x')).toEqual({ ok: true, value: 4 })
    expect(normalizeQuantity('X4')).toEqual({ ok: true, value: 4 })
  })

  test('treats an empty cell as unspecified', () => {
    expect(normalizeQuantity('')).toEqual({ ok: true, value: undefined })
  })

  test('rejects zero and non-numeric values', () => {
    expect(normalizeQuantity('0')).toEqual({
      ok: false,
      error: "Invalid quantity '0': must be at least 1",
    })
    expect(normalizeQuantity('many')).toEqual({ ok: false, error: "Invalid quantity 'many'" })
  })
})

describe('convertCsvRows', () => {
  const row = (cells: string[], lineNumber: number): CsvRow => ({
    cells,
    lineNumber,
    raw: cells.join(','),
  })

  test('converts valid rows and normalizes values', () => {
    const mapping = parseColumnsSpec(
      'name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6',
      'collection',
    ) as ColumnMapping
    const { entries, failures } = convertCsvRows(
      [row(['Sol Ring', 'C19', '221', 'F', 'Near Mint', '2'], 2)],
      mapping,
      'collection',
    )
    expect(failures).toEqual([])
    expect(entries).toEqual([
      {
        name: 'Sol Ring',
        quantity: 2,
        set: 'c19',
        collectorNumber: '221',
        finish: 'foil',
        condition: 'NM',
        section: 'Main',
      },
    ])
  })

  test('collects failures with line numbers while importing the rest', () => {
    const mapping = parseColumnsSpec(
      'name=1,set=2,collector-number=3',
      'collection',
    ) as ColumnMapping
    const { entries, failures } = convertCsvRows(
      [
        row(['Sol Ring', 'C19', '221'], 2),
        row(['', 'C19', '5'], 3),
        row(['Arcane Signet', '', ''], 4),
      ],
      mapping,
      'collection',
    )
    expect(entries).toHaveLength(1)
    expect(failures).toEqual([
      { lineNumber: 3, raw: ',C19,5', reason: 'Missing card name' },
      {
        lineNumber: 4,
        raw: 'Arcane Signet,,',
        reason:
          'Missing set code (required for collections); Missing collector number (required for collections)',
      },
    ])
  })

  test('reports all problems for a single bad row', () => {
    const mapping = parseColumnsSpec(
      'name=1,condition=2,finish=3,quantity=4',
      'deck',
    ) as ColumnMapping
    const { failures } = convertCsvRows(
      [row(['Sol Ring', 'pristine', 'glossy', 'lots'], 7)],
      mapping,
      'deck',
    )
    expect(failures).toEqual([
      {
        lineNumber: 7,
        raw: 'Sol Ring,pristine,glossy,lots',
        reason:
          "Unrecognized condition 'pristine'; Unrecognized finish 'glossy'; Invalid quantity 'lots'",
      },
    ])
  })

  test('allows name-only rows for decks and wanted lists', () => {
    const mapping = parseColumnsSpec('name=1', 'wanted') as ColumnMapping
    const { entries, failures } = convertCsvRows([row(['Lightning Bolt'], 1)], mapping, 'wanted')
    expect(failures).toEqual([])
    expect(entries).toEqual([
      {
        name: 'Lightning Bolt',
        quantity: 1,
        set: undefined,
        collectorNumber: undefined,
        finish: undefined,
        condition: undefined,
        section: 'Main',
      },
    ])
  })

  test('treats a missing cell in a short row as empty', () => {
    const mapping = parseColumnsSpec('name=1,section=5', 'deck') as ColumnMapping
    const { entries } = convertCsvRows([row(['Sol Ring'], 1)], mapping, 'deck')
    expect(entries[0]!.section).toBe('Main')
  })

  test('strips condition from wanted entries even when the mapping has one', () => {
    // parseColumnsSpec rejects this mapping, but convertCsvRows accepts any
    // ColumnMapping directly and must enforce the rule itself.
    const mapping: ColumnMapping = { name: 0, condition: 1 }
    const { entries, failures } = convertCsvRows([row(['Sol Ring', 'NM'], 1)], mapping, 'wanted')
    expect(failures).toEqual([])
    expect(entries[0]!.condition).toBeUndefined()
  })

  test('keeps explicit sections verbatim on flat lists', () => {
    const mapping = parseColumnsSpec('name=1,set=2,collector-number=3,section=4', 'collection')
    const { entries } = convertCsvRows(
      [row(['Sol Ring', 'C19', '221', 'Trade Binder'], 1)],
      mapping as ColumnMapping,
      'collection',
    )
    expect(entries[0]!.section).toBe('Trade Binder')
  })
})

describe('header guessing', () => {
  test('guessHasHeader recognizes common header names', () => {
    expect(guessHasHeader(['Name', 'Set', 'Collector Number', 'Finish'])).toBe(true)
    expect(guessHasHeader(['Count', 'Card Name', 'Edition'])).toBe(true)
    expect(guessHasHeader(['Sol Ring', 'C19', '221'])).toBe(false)
  })

  test('guessColumns maps header cells to fields', () => {
    expect(guessColumns(['Quantity', 'Name', 'Set Code', 'Collector Number', 'Foil'])).toEqual({
      quantity: 0,
      name: 1,
      set: 2,
      collectorNumber: 3,
      finish: 4,
    })
  })
})
