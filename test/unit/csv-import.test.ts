import { describe, expect, test } from 'bun:test'
import {
  CSV_FIELDS,
  CSV_HEADER_ALIAS_KEYS,
  convertCsvRows,
  csvHeaderAliases,
  csvRowWarningMessage,
  formatColumnsSpec,
  guessColumns,
  guessHasHeader,
  HEADER_ALIAS_SEPARATOR,
  normalizeCondition,
  normalizeFinish,
  normalizeLanguage,
  normalizeQuantity,
  normalizeSection,
  parseColumnsSpec,
  parseCsv,
  validateMapping,
  validateMappingWidth,
  type ColumnMapping,
  type CsvRow,
  type CsvRowFailure,
  type NormalizedField,
} from '../../src/importers/csv'
import { isSyncMessage, type SyncMessage } from '../../src/sync/message'
import { DEFAULT_LOCALE, resetI18nRuntime } from '../../src/i18n/runtime'
import { tIn } from '../../src/i18n/t'
import { en } from '../../src/i18n/messages/en'
import type { LocaleCatalog, LocaleTag } from '../../src/i18n/types'
import { keyedMessage } from '../helpers/api-message'
import { loadSyntheticLocale, pseudoCatalog, withSyntheticLocale } from '../helpers/sync-text'
import { formatScriptingCommand } from '../../src/commands/import'
import type { CardLanguage } from '../../src/card/card-language'
import { invalidCardTagMessage } from '../../src/card/card-tags'
import type { Condition, Finish } from '../../src/card/finish-condition'

function rowsOf(result: ReturnType<typeof parseCsv>): CsvRow[] {
  if ('error' in result) throw new Error(`Unexpected parse error: ${result.error.message}`)
  return result.rows
}

/** A refusal's English, after checking it agrees with its key and params. */
function refusalText(value: ColumnMapping | SyncMessage | null): string {
  if (value === null || !isSyncMessage(value)) {
    throw new Error(`expected a refusal, got ${JSON.stringify(value)}`)
  }
  return keyedMessage(value)
}

/** A cell normalizer's refusal as English, checked against its key. */
function refusedWith<T>(result: NormalizedField<T>): string {
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result)}`)
  return keyedMessage(result.error)
}

/** A row failure as the English a reader sees. */
type FailureView = { lineNumber: number; raw: string; reason: string }

/**
 * A row failure's English, after checking a keyed reason agrees with its key
 * and params. A keyless reason is text another module worded (a tag refusal).
 */
function failureView(failure: CsvRowFailure): FailureView {
  if (failure.reasonKey !== undefined) {
    keyedMessage({
      message: failure.reason,
      messageKey: failure.reasonKey,
      messageParams: failure.reasonParams,
    })
  }
  return { lineNumber: failure.lineNumber, raw: failure.raw, reason: failure.reason }
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
    if (!('error' in result)) throw new Error('expected the parse to fail')
    expect(keyedMessage(result.error)).toBe('Unterminated quoted field starting on line 2')
  })
})

describe('parseColumnsSpec', () => {
  test('parses a 1-based spec into a 0-based mapping', () => {
    const mapping = parseColumnsSpec('name=1,set=2,collector-number=3,quantity=6', 'collection')
    expect(mapping).toEqual({ name: 0, set: 1, collectorNumber: 2, quantity: 5 })
  })

  test('rejects unknown fields', () => {
    expect(refusalText(parseColumnsSpec('name=1,rarity=2', 'deck'))).toMatch(
      /Unknown field 'rarity'/,
    )
  })

  test('rejects duplicate fields and missing name', () => {
    expect(refusalText(parseColumnsSpec('name=1,name=2', 'deck'))).toMatch(/mapped more than once/)
    expect(refusalText(parseColumnsSpec('set=1', 'deck'))).toMatch(/Missing required field 'name'/)
  })

  test('rejects non-numeric and zero column numbers', () => {
    expect(refusalText(parseColumnsSpec('name=first', 'deck'))).toMatch(/Invalid column number/)
    expect(refusalText(parseColumnsSpec('name=0', 'deck'))).toMatch(/Invalid column number/)
  })

  test('requires set and collector-number for collections', () => {
    expect(refusalText(parseColumnsSpec('name=1', 'collection'))).toMatch(
      /require both a set and a collector/,
    )
  })
})

describe('formatColumnsSpec', () => {
  test('round-trips a mapping back to the 1-based flag value', () => {
    const mapping = parseColumnsSpec(
      'name=2,set=1,finish=4,tags=5,quantity=3',
      'deck',
    ) as ColumnMapping
    expect(formatColumnsSpec(mapping)).toBe('name=2,set=1,finish=4,tags=5,quantity=3')
  })

  test('round-trips a spec including a categories column', () => {
    const mapping = parseColumnsSpec('name=1,categories=6', 'deck') as ColumnMapping
    expect(mapping.categories).toBe(5)
    expect(formatColumnsSpec(mapping)).toBe('name=1,categories=6')
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
        false,
      ),
    ).toBe(
      "ritual import 'My Cards.csv' --type collection --name 'Red Binder' --columns name=1,set=2,collector-number=3,quantity=4",
    )
    expect(
      formatScriptingCommand('deck.csv', 'deck', 'Burn', 'create', 'modern', mapping, false, false),
    ).toBe(
      'ritual import deck.csv --type deck --name Burn --deck-format modern --columns name=1,set=2,collector-number=3,quantity=4 --no-header',
    )
    expect(
      formatScriptingCommand(
        'more.csv',
        'wanted',
        'To Buy',
        'append',
        undefined,
        mapping,
        true,
        false,
      ),
    ).toBe(
      "ritual import more.csv --type wanted --name 'To Buy' --append --columns name=1,set=2,collector-number=3,quantity=4",
    )
    expect(
      formatScriptingCommand(
        'deck.csv',
        'deck',
        'Burn',
        'overwrite',
        'modern',
        mapping,
        true,
        false,
      ),
    ).toBe(
      'ritual import deck.csv --type deck --name Burn --overwrite --deck-format modern --columns name=1,set=2,collector-number=3,quantity=4',
    )
  })

  test('adds --csv for files whose extension would not trigger CSV detection', () => {
    const mapping = parseColumnsSpec('name=1,quantity=2', 'wanted') as ColumnMapping
    expect(
      formatScriptingCommand(
        'cards.txt',
        'wanted',
        'To Buy',
        'create',
        undefined,
        mapping,
        true,
        true,
      ),
    ).toBe(
      "ritual import cards.txt --csv --type wanted --name 'To Buy' --columns name=1,quantity=2",
    )
  })
})

describe('validateMapping', () => {
  test('accepts a deck mapping with only a name column', () => {
    expect(validateMapping({ name: 0 }, 'deck')).toBeNull()
  })

  test('requires a printing for collections', () => {
    expect(refusalText(validateMapping({ name: 0, set: 1 }, 'collection'))).toMatch(
      /require both a set and a collector/,
    )
  })

  test('rejects a condition column for wanted lists', () => {
    expect(refusalText(validateMapping({ name: 0, condition: 1 }, 'wanted'))).toMatch(
      /do not track condition/,
    )
  })

  test('rejects two fields mapped to the same column', () => {
    expect(refusalText(validateMapping({ name: 0, finish: 0 }, 'deck'))).toBe(
      "Fields 'name' and 'finish' are mapped to the same column 1",
    )
    expect(refusalText(validateMapping({ name: 0, categories: 1, section: 1 }, 'deck'))).toMatch(
      /same column 2/,
    )
  })
})

describe('validateMappingWidth', () => {
  test('accepts a mapping whose columns all exist', () => {
    expect(validateMappingWidth({ name: 0, set: 1, quantity: 2 }, 3)).toBeNull()
  })

  test('names the out-of-range column, its field, and the file width', () => {
    expect(refusalText(validateMappingWidth({ name: 98 }, 6))).toBe(
      "Column 99 (mapped to 'name') does not exist: the file has 6 columns",
    )
    // The width is a count, so the noun follows it.
    expect(refusalText(validateMappingWidth({ name: 0, set: 1 }, 1))).toBe(
      "Column 2 (mapped to 'set') does not exist: the file has 1 column",
    )
  })

  test('rejects the first out-of-range field in canonical order', () => {
    expect(refusalText(validateMappingWidth({ name: 0, set: 9, quantity: 8 }, 2))).toMatch(
      /Column 10 \(mapped to 'set'\)/,
    )
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
    expect(refusedWith(normalizeCondition('shiny'))).toBe("Unrecognized condition 'shiny'")
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
    expect(refusedWith(normalizeFinish('glossy'))).toBe("Unrecognized finish 'glossy'")
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
    expect(refusedWith(normalizeQuantity('0'))).toBe("Invalid quantity '0': must be at least 1")
    expect(refusedWith(normalizeQuantity('many'))).toBe("Invalid quantity 'many'")
  })
})

describe('normalizeLanguage', () => {
  test.each<[string, string]>([
    ['ja', 'ja'],
    ['JA', 'ja'],
    ['JP', 'ja'],
    ['kr', 'ko'],
    ['SP', 'es'],
    ['cs', 'zhs'],
    ['CT', 'zht'],
    ['Japanese', 'ja'],
    ['simplified chinese', 'zhs'],
    ['Phyrexian', 'ph'],
  ])("normalizes '%s' to '%s'", (input, expected) => {
    expect(normalizeLanguage(input)).toEqual({ ok: true, value: expected as CardLanguage })
  })

  test('an empty cell means no language', () => {
    expect(normalizeLanguage('')).toEqual({ ok: true, value: undefined })
    expect(normalizeLanguage('   ')).toEqual({ ok: true, value: undefined })
  })

  test('an explicit English normalizes to undefined — a bare line is how en is written', () => {
    expect(normalizeLanguage('en')).toEqual({ ok: true, value: undefined })
    expect(normalizeLanguage('English')).toEqual({ ok: true, value: undefined })
  })

  test('rejects a value naming no language', () => {
    expect(refusedWith(normalizeLanguage('klingon'))).toBe("Unrecognized language 'klingon'")
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
    expect(failures.map(failureView)).toEqual([
      { lineNumber: 3, raw: ',C19,5', reason: 'Missing card name' },
      {
        lineNumber: 4,
        raw: 'Arcane Signet,,',
        reason:
          'Missing set code (required for collections); Missing collector number (required for collections)',
      },
    ])
  })

  test('a row failing for one reason carries that reason’s own key', () => {
    const mapping: ColumnMapping = { name: 0, set: 1 }
    const { failures } = convertCsvRows([row(['', 'C19'], 2)], mapping, 'deck')
    expect(failures).toEqual([
      {
        lineNumber: 2,
        raw: ',C19',
        reason: 'Missing card name',
        reasonKey: 'domain.import.csv.missingName',
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
    expect(failures.map(failureView)).toEqual([
      {
        lineNumber: 7,
        raw: 'Sol Ring,pristine,glossy,lots',
        reason:
          "Unrecognized condition 'pristine'; Unrecognized finish 'glossy'; Invalid quantity 'lots'",
      },
    ])
  })

  test('fails a row whose quoted name spans lines, instead of writing forged lines', () => {
    const mapping = parseColumnsSpec('name=1', 'wanted') as ColumnMapping
    const { entries, failures } = convertCsvRows(
      [row(['Sol Ring\n- Black Lotus (LEA:232) &9'], 2)],
      mapping,
      'wanted',
    )
    expect(entries).toEqual([])
    expect(failures.map((failure) => failure.reason)).toEqual([
      'Line break inside the card name, set code, or collector number',
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

  test('carries a mapped language column, dropping the token for English cells', () => {
    const mapping = parseColumnsSpec(
      'name=1,set=2,collector-number=3,language=4',
      'collection',
    ) as ColumnMapping
    const { entries, failures } = convertCsvRows(
      [
        row(['Sol Ring', 'C19', '221', 'JP'], 1),
        row(['Sol Ring', 'C19', '221', 'EN'], 2),
        row(['Sol Ring', 'C19', '221', ''], 3),
      ],
      mapping,
      'collection',
    )
    expect(failures).toEqual([])
    expect(entries.map((entry) => entry.language)).toEqual(['ja', undefined, undefined])
  })

  test('a bad language cell fails its row with the standard per-row error', () => {
    const mapping = parseColumnsSpec('name=1,language=2', 'deck') as ColumnMapping
    const { entries, failures } = convertCsvRows(
      [row(['Sol Ring', 'klingon'], 4), row(['Arcane Signet', 'German'], 5)],
      mapping,
      'deck',
    )
    expect(entries.map((entry) => entry.language)).toEqual(['de'])
    expect(failures.map(failureView)).toEqual([
      { lineNumber: 4, raw: 'Sol Ring,klingon', reason: "Unrecognized language 'klingon'" },
    ])
  })

  test('a mapped tags column reads the typed-input grammar and stores the canonical set', () => {
    const mapping = parseColumnsSpec('name=1,tags=2', 'deck') as ColumnMapping
    const { entries, failures } = convertCsvRows(
      [row(['Sol Ring', 'staple, Card Draw'], 1), row(['Arcane Signet', ''], 2)],
      mapping,
      'deck',
    )
    expect(failures).toEqual([])
    expect(entries.map((entry) => entry.tags)).toEqual([['Card Draw', 'staple'], undefined])
  })

  test('a malformed tag cell fails its row with the parser’s message', () => {
    const mapping = parseColumnsSpec('name=1,tags=2', 'deck') as ColumnMapping
    const { entries, failures } = convertCsvRows(
      [row(['Sol Ring', 'R&D'], 4), row(['Arcane Signet', 'edh'], 5)],
      mapping,
      'deck',
    )
    expect(entries.map((entry) => entry.tags)).toEqual([['edh']])
    // The tag grammar words its own refusal; it rides keyless.
    expect(failures).toEqual([
      { lineNumber: 4, raw: 'Sol Ring,R&D', reason: invalidCardTagMessage('R&D') },
    ])
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

  describe('categories column', () => {
    const convert = (cells: string[], spec: string, listType: 'deck' | 'collection' | 'wanted') =>
      convertCsvRows([row(cells, 7)], parseColumnsSpec(spec, listType) as ColumnMapping, listType)

    test('reads the typed-input grammar, keeping cell order (first is primary)', () => {
      const { entries, failures, warnings } = convert(
        ['Sol Ring', 'Ramp, Artifacts'],
        'name=1,categories=2',
        'deck',
      )
      expect(failures).toEqual([])
      expect(warnings).toEqual([])
      expect(entries[0]!.categories).toEqual(['Ramp', 'Artifacts'])
    })

    test('a blank cell leaves no categories and no warning', () => {
      const { entries, warnings } = convert(['Sol Ring', ''], 'name=1,categories=2', 'deck')
      expect(entries[0]!.categories).toBeUndefined()
      expect(warnings).toEqual([])
    })

    // An Archidekt Category column routinely holds names the category grammar
    // forbids; losing the card over one would defeat the whole feature.
    test('a refused value is dropped and warned about, and the card still imports', () => {
      const { entries, failures, warnings } = convert(
        ['Sol Ring', 'Ramp\tRocks, Draw'],
        'name=1,categories=2',
        'deck',
      )
      expect(failures).toEqual([])
      expect(entries[0]!.categories).toEqual(['Draw'])
      expect(warnings).toEqual([
        { kind: 'category-ignored', lineNumber: 7, cardName: 'Sol Ring', value: 'Ramp\tRocks' },
      ])
      expect(warnings.map(csvRowWarningMessage).map(keyedMessage)).toEqual([
        'Line 7: ignored category "Ramp\\tRocks" on "Sol Ring"',
      ])
    })

    test('a cell whose only value is refused still imports the card, with no categories', () => {
      const { entries, failures, warnings } = convert(
        ['Sol Ring', 'Draw\tFilter'],
        'name=1,categories=2',
        'deck',
      )
      expect(failures).toEqual([])
      expect(entries).toHaveLength(1)
      expect(entries[0]!.categories).toBeUndefined()
      expect(warnings).toHaveLength(1)
    })

    test('a deck routes a board value to the section and keeps the rest as categories', () => {
      const { entries, warnings } = convert(
        ['Sol Ring', 'Ramp,Sideboard'],
        'name=1,categories=2',
        'deck',
      )
      expect(entries[0]!.section).toBe('Sideboard')
      expect(entries[0]!.categories).toEqual(['Ramp'])
      // A board value is a board, never a refusal — but it silently stopped
      // being a category, so the row says what became of it.
      expect(warnings).toEqual([
        {
          kind: 'category-is-board',
          lineNumber: 7,
          cardName: 'Sol Ring',
          value: 'Sideboard',
          section: 'Sideboard',
        },
      ])
      expect(warnings.map(csvRowWarningMessage).map(keyedMessage)).toEqual([
        `Line 7: category "Sideboard" names a board — dropped from the categories,` +
          ` and the row's section is 'Sideboard' on "Sol Ring"`,
      ])
    })

    // `Tokens`, `Oathbreaker` and `Signature Spell` are known only to
    // `sectionRole()`, whose canonical header is derived from the role's own
    // first alias; `Command Zone` is deliberately included as the case where
    // both alias tables agree.
    test.each<[string, string]>([
      ['Tokens', 'Tokens'],
      ['Command Zone', 'Commander'],
      ['Oathbreaker', 'Oathbreaker'],
      ['Signature Spell', 'Oathbreaker'],
    ])('a deck routes the board value %s to section %s', (cell, section) => {
      const { entries } = convert(['Sol Ring', cell], 'name=1,categories=2', 'deck')
      expect(entries[0]!.section).toBe(section)
      expect(entries[0]!.categories).toBeUndefined()
    })

    test('a deck routes a board value only the CSV alias table knows', () => {
      const { entries } = convert(['Sol Ring', 'Ramp,sb'], 'name=1,categories=2', 'deck')
      expect(entries[0]!.section).toBe('Sideboard')
      expect(entries[0]!.categories).toEqual(['Ramp'])
    })

    test('the first board value wins when a cell names two', () => {
      const { entries } = convert(
        ['Sol Ring', 'Sideboard,Maybeboard,Ramp'],
        'name=1,categories=2',
        'deck',
      )
      expect(entries[0]!.section).toBe('Sideboard')
      expect(entries[0]!.categories).toEqual(['Ramp'])
    })

    test('an explicit section cell wins, and the board value is still dropped', () => {
      const { entries, warnings } = convert(
        ['Sol Ring', 'Ramp,Sideboard', 'Main'],
        'name=1,categories=2,section=3',
        'deck',
      )
      expect(entries[0]!.section).toBe('Main')
      expect(entries[0]!.categories).toEqual(['Ramp'])
      // The routing notice reports the section the row actually landed in.
      expect(warnings.map(csvRowWarningMessage).map(keyedMessage)).toEqual([
        `Line 7: category "Sideboard" names a board — dropped from the categories,` +
          ` and the row's section is 'Main' on "Sol Ring"`,
      ])
    })

    // A warning is a notice about a row that DID import: a row dropped for an
    // unrelated reason must not also report a decision about a card no one has
    // — and on a nameless row the message would name an empty card.
    test('a row that fails for another reason produces no category warning', () => {
      const { entries, failures, warnings } = convert(
        ['', 'Ramp\tRocks'],
        'name=1,categories=2',
        'deck',
      )
      expect(entries).toEqual([])
      expect(failures).toHaveLength(1)
      expect(warnings).toEqual([])
    })

    test('flat lists keep a board-shaped value as an ordinary category', () => {
      const { entries } = convert(
        ['Sol Ring', 'C19', '221', 'Ramp,Sideboard'],
        'name=1,set=2,collector-number=3,categories=4',
        'collection',
      )
      expect(entries[0]!.section).toBe('Main')
      expect(entries[0]!.categories).toEqual(['Ramp', 'Sideboard'])
    })
  })
})

/** English alone: the languages a guess recognizes besides English, none. */
const ENGLISH_ONLY: readonly LocaleTag[] = [DEFAULT_LOCALE]

describe('header guessing', () => {
  test('guessHasHeader recognizes common header names', () => {
    expect(guessHasHeader(['Name', 'Set', 'Collector Number', 'Finish'], ENGLISH_ONLY)).toBe(true)
    expect(guessHasHeader(['Count', 'Card Name', 'Edition'], ENGLISH_ONLY)).toBe(true)
    expect(guessHasHeader(['Sol Ring', 'C19', '221'], ENGLISH_ONLY)).toBe(false)
  })

  test('guessColumns maps header cells to fields', () => {
    expect(
      guessColumns(['Quantity', 'Name', 'Set Code', 'Collector Number', 'Foil'], ENGLISH_ONLY),
    ).toEqual({
      quantity: 0,
      name: 1,
      set: 2,
      collectorNumber: 3,
      finish: 4,
    })
  })

  test('recognizes language headers, long and short', () => {
    expect(guessHasHeader(['Language', 'Something'], ENGLISH_ONLY)).toBe(true)
    expect(guessColumns(['Name', 'Language'], ENGLISH_ONLY)).toEqual({ name: 0, language: 1 })
    expect(guessColumns(['Name', 'Lang'], ENGLISH_ONLY)).toEqual({ name: 0, language: 1 })
  })

  test('recognizes a tags header, plural and singular', () => {
    expect(guessColumns(['Name', 'Tags'], ENGLISH_ONLY)).toEqual({ name: 0, tags: 1 })
    expect(guessColumns(['Name', 'Tag'], ENGLISH_ONLY)).toEqual({ name: 0, tags: 1 })
  })

  // `Category` used to mean the section; it is the categories field now, and
  // `Section`/`Board` are the section headers.
  test('recognizes a categories header, and keeps Section/Board as the section', () => {
    expect(guessColumns(['Name', 'Category'], ENGLISH_ONLY)).toEqual({ name: 0, categories: 1 })
    expect(guessColumns(['Name', 'Categories'], ENGLISH_ONLY)).toEqual({ name: 0, categories: 1 })
    expect(guessColumns(['Name', 'Section'], ENGLISH_ONLY)).toEqual({ name: 0, section: 1 })
    expect(guessColumns(['Name', 'Board'], ENGLISH_ONLY)).toEqual({ name: 0, section: 1 })
  })
})

/**
 * The header spellings a translation adds (`domain.import.csv.headers.*`). The
 * English ones are a contract with the files already out there: a translation
 * only ever adds to them, and only fills a field no English heading named.
 */
describe('localized header spellings', () => {
  /** A German-like translation's spellings, one of them colliding with English. */
  const GERMAN: LocaleCatalog = {
    'domain.import.csv.headers.name': 'Kartenname|Name der Karte',
    'domain.import.csv.headers.quantity': 'Anzahl',
    // `Number` is English for the collector number; the translation's claim on
    // it for the set must lose.
    'domain.import.csv.headers.set': 'Edition|Number',
  }

  const ENGLISH_EXPORT = ['Count', 'Name', 'Edition', 'Collector Number', 'Foil', 'Language']
  const ENGLISH_GUESS: Partial<ColumnMapping> = {
    quantity: 0,
    name: 1,
    set: 2,
    collectorNumber: 3,
    finish: 4,
    language: 5,
  }

  test('a translation’s spellings are recognized for its language', () => {
    const german = loadSyntheticLocale('de', GERMAN)
    try {
      expect(guessHasHeader(['Kartenname', 'Sol Ring'], [german])).toBe(true)
      expect(guessColumns(['Anzahl', 'Name der Karte'], [german])).toEqual({
        quantity: 0,
        name: 1,
      })
    } finally {
      resetI18nRuntime()
    }
  })

  test('…and only there: English does not know them', () => {
    // Vacuity guard for the test above: the spellings come from the catalog.
    expect(guessHasHeader(['Kartenname', 'Anzahl'], ENGLISH_ONLY)).toBe(false)
    expect(guessColumns(['Anzahl', 'Name der Karte'], ENGLISH_ONLY)).toEqual({})
  })

  test('the languages named are the ones read, whatever language is applied', () => {
    // Loaded but not applied: named explicitly, it is honoured…
    const german = loadSyntheticLocale('de', GERMAN)
    try {
      expect(guessColumns(['Anzahl'], [german])).toEqual({ quantity: 0 })
      expect(guessColumns(['Anzahl'], ENGLISH_ONLY)).toEqual({})
    } finally {
      resetI18nRuntime()
    }
    // …and applied but not named, it is not: the ambient language never leaks in.
    withSyntheticLocale('de', GERMAN, () => {
      expect(guessColumns(['Anzahl'], ENGLISH_ONLY)).toEqual({})
      expect(guessHasHeader(['Anzahl'], ENGLISH_ONLY)).toBe(false)
    })
  })

  test('English headings keep their fields under every language', () => {
    expect(guessColumns(ENGLISH_EXPORT, ENGLISH_ONLY)).toEqual(ENGLISH_GUESS)
    for (const [tag, catalog] of [
      ['en-XA', pseudoCatalog()],
      ['de', GERMAN],
    ] as const) {
      const locale = loadSyntheticLocale(tag, catalog)
      try {
        expect(guessHasHeader(ENGLISH_EXPORT, [locale])).toBe(true)
        expect(guessColumns(ENGLISH_EXPORT, [locale])).toEqual(ENGLISH_GUESS)
        // The colliding spelling stays English's: collector number, not set.
        expect(guessColumns(['Name', 'Number'], [locale])).toEqual({ name: 0, collectorNumber: 1 })
      } finally {
        resetI18nRuntime()
      }
    }
  })

  test('a translation only fills fields no English heading named', () => {
    // `Edition Name` added for the set must not beat the English `Edition Code`
    // further right: accepting that default would write set *names* as codes.
    const locale = loadSyntheticLocale('de', {
      'domain.import.csv.headers.set': 'Edition Name',
      'domain.import.csv.headers.quantity': 'Anzahl',
    })
    try {
      expect(guessColumns(['Name', 'Edition Name', 'Edition Code'], [locale])).toEqual({
        name: 0,
        set: 2,
      })
      // With no English heading for the field, the translation's fills it.
      expect(guessColumns(['Name', 'Edition Name', 'Anzahl'], [locale])).toEqual({
        name: 0,
        set: 1,
        quantity: 2,
      })
    } finally {
      resetI18nRuntime()
    }
  })

  test('between a translation’s own colliding spellings, the earlier field wins', () => {
    // `Karte` listed for both the name and the set: name comes first in CSV_FIELDS.
    const locale = loadSyntheticLocale('de', {
      'domain.import.csv.headers.name': 'Karte',
      'domain.import.csv.headers.set': 'Karte|Edition',
    })
    try {
      expect(guessColumns(['Karte', 'Kartenzahl'], [locale])).toEqual({ name: 0 })
      expect(csvHeaderAliases([locale]).localized.get('karte')).toBe('name')
    } finally {
      resetI18nRuntime()
    }
  })

  test('a heading matches whether its accent is precomposed or combining', () => {
    const locale = loadSyntheticLocale('es', {
      'domain.import.csv.headers.collectorNumber': 'N\u00famero',
    })
    try {
      // U+0301 COMBINING ACUTE after a plain `u`: the same word, decomposed.
      expect(guessColumns(['Nombre', 'Nu\u0301mero'], [locale])).toEqual({ collectorNumber: 1 })
    } finally {
      resetI18nRuntime()
    }
  })

  test('every English catalog spelling is already an English heading, for its field', () => {
    // The English catalog entries are examples for translators, never a source:
    // each must name its own field in the built-in English table.
    const { english, localized } = csvHeaderAliases(ENGLISH_ONLY)
    for (const field of CSV_FIELDS) {
      const value = en[CSV_HEADER_ALIAS_KEYS[field]]
      for (const spelling of value.split(HEADER_ALIAS_SEPARATOR)) {
        expect({
          spelling,
          field: english.get(spelling.toLowerCase().replace(/[\s\-_]+/g, '')),
        }).toEqual({ spelling, field })
      }
    }
    expect(localized.size).toBe(0)
  })

  test('the English catalog entries add nothing beyond the English contract', () => {
    // With every spelling key emptied, only the built-in English table is left;
    // the English catalog must recognize exactly that — so an edit to the
    // catalog's English can never change what an import reads.
    const emptied: LocaleCatalog = Object.fromEntries(
      CSV_FIELDS.map((field) => [CSV_HEADER_ALIAS_KEYS[field], '']),
    )
    const locale = loadSyntheticLocale('en-ZZ', emptied)
    try {
      // Vacuity guard: the emptied dictionary really is what is read.
      expect(tIn(locale, 'domain.import.csv.headers.name')).toBe('')
      const builtIn = csvHeaderAliases([locale])
      expect(builtIn.localized.size).toBe(0)
      expect(csvHeaderAliases(ENGLISH_ONLY)).toEqual(builtIn)
      expect(builtIn.english.size).toBeGreaterThan(CSV_FIELDS.length)
    } finally {
      resetI18nRuntime()
    }
  })
})
