import { describe, expect, test } from 'bun:test'
import {
  ARCHIDEKT_EXPORT_SETTINGS,
  BUILT_IN_EXPORT_PRESETS,
  exportPresetNames,
  findExportPreset,
  parseExportPresets,
  resolveExportSettings,
  type ExportPreset,
} from '../../src/export/presets'
import { DEFAULT_EXPORT_COLUMNS, exportPropertyLabel } from '../../src/export/render'

describe('parseExportPresets', () => {
  test('returns an empty map when absent', () => {
    expect(parseExportPresets(undefined)).toEqual({})
  })

  test('parses a valid preset map', () => {
    const result = parseExportPresets({
      deckbox: { format: 'csv', columns: ['name', 'quantity'], header: false, quoteAll: true },
      dump: { format: 'json', columns: ['name', 'set', 'listName'] },
    })
    expect(result).toEqual({
      deckbox: { format: 'csv', columns: ['name', 'quantity'], header: false, quoteAll: true },
      dump: { format: 'json', columns: ['name', 'set', 'listName'] },
    })
  })

  test('accepts the fixed-line text and md formats (columns stored but unused)', () => {
    const result = parseExportPresets({
      list: { format: 'text', columns: ['name'] },
      files: { format: 'md', columns: ['name'] },
    })
    expect(result).toEqual({
      list: { format: 'text', columns: ['name'] },
      files: { format: 'md', columns: ['name'] },
    })
  })

  test.each([
    ['not an object', ['a'], '"exportPresets" must be an object'],
    ['non-object preset', { p: 'csv' }, 'exportPresets["p"] must be an object'],
    ['bad format', { p: { format: 'xml', columns: ['name'] } }, '.format must be one of'],
    ['non-array columns', { p: { format: 'csv', columns: 'name' } }, '.columns must be an array'],
    ['empty columns', { p: { format: 'csv', columns: [] } }, '.columns: No columns given'],
    [
      'unknown column',
      { p: { format: 'csv', columns: ['price'] } },
      ".columns: Unknown column 'price'",
    ],
    [
      'duplicate column',
      { p: { format: 'csv', columns: ['name', 'name'] } },
      ".columns: Duplicate column 'name'",
    ],
    [
      'non-boolean header',
      { p: { format: 'csv', columns: ['name'], header: 'yes' } },
      '.header must be a boolean',
    ],
    [
      'non-boolean quoteAll',
      { p: { format: 'csv', columns: ['name'], quoteAll: 1 } },
      '.quoteAll must be a boolean',
    ],
    [
      'unknown dialect',
      { p: { format: 'csv', columns: ['name'], dialect: 'moxfield' } },
      '.dialect must be one of: ritual, archidekt',
    ],
  ])('rejects %s with an error string', (_label, value, expected) => {
    const result = parseExportPresets(value)
    expect(typeof result).toBe('string')
    expect(result).toContain(expected)
  })

  test('keeps a valid dialect', () => {
    expect(
      parseExportPresets({ p: { format: 'csv', columns: ['name'], dialect: 'archidekt' } }),
    ).toEqual({ p: { format: 'csv', columns: ['name'], dialect: 'archidekt' } })
  })
})

describe('built-in presets', () => {
  test('the archidekt preset is the CSV Archidekt imports', () => {
    expect(BUILT_IN_EXPORT_PRESETS.archidekt).toEqual({
      format: 'csv',
      columns: ['scryfallId', 'quantity', 'finish', 'condition', 'language'],
      header: true,
      quoteAll: false,
      dialect: 'archidekt',
    })
    // What the collection sync renders its upload with, independent of config.
    expect(ARCHIDEKT_EXPORT_SETTINGS).toEqual({
      format: 'csv',
      columns: ['scryfallId', 'quantity', 'finish', 'condition', 'language'],
      header: true,
      quoteAll: false,
      dialect: 'archidekt',
    })
  })

  /**
   * The header Archidekt's importer reads each column under. What each column
   * *means* to the upload is derived from these same properties
   * (`COLLECTION_CSV_UPLOAD`, pinned in collection-sync/csv.test.ts), so a
   * reorder cannot desync the two — but the labels are what a human uploading the
   * file by hand matches up, and they are Archidekt's own spellings.
   */
  test('the archidekt preset columns carry Archidekt’s own header labels', () => {
    expect(
      ARCHIDEKT_EXPORT_SETTINGS.columns.map((c) => exportPropertyLabel(c, 'archidekt')),
    ).toEqual(['Scryfall ID', 'Quantity', 'Variant', 'Condition', 'Language'])
  })

  test('resolved settings never alias the preset’s own column array', () => {
    // The resolved columns are handed to renderers that take a mutable array; a
    // shared instance sorted in place would change every later export, including
    // the CSV a collection push uploads.
    const preset = BUILT_IN_EXPORT_PRESETS.archidekt!
    const resolved = resolveExportSettings(preset, {})

    expect(resolved.columns).not.toBe(preset.columns)
    resolved.columns.reverse()
    expect(preset.columns).toEqual(['scryfallId', 'quantity', 'finish', 'condition', 'language'])
  })

  test('built-ins are available by name, and a saved preset of that name wins', () => {
    expect(findExportPreset('archidekt', {})).toBe(BUILT_IN_EXPORT_PRESETS.archidekt)
    const mine: ExportPreset = { format: 'json', columns: ['name'] }
    expect(findExportPreset('archidekt', { archidekt: mine })).toBe(mine)
    expect(findExportPreset('nope', {})).toBeUndefined()
  })

  test('preset names list saved ones first, then unshadowed built-ins', () => {
    expect(exportPresetNames({})).toEqual(['archidekt'])
    expect(exportPresetNames({ mini: { format: 'csv', columns: ['name'] } })).toEqual([
      'mini',
      'archidekt',
    ])
    expect(exportPresetNames({ archidekt: { format: 'csv', columns: ['name'] } })).toEqual([
      'archidekt',
    ])
  })
})

describe('resolveExportSettings', () => {
  const preset: ExportPreset = {
    format: 'json',
    columns: ['name', 'listName'],
    header: false,
    quoteAll: true,
  }

  test('falls back to defaults with no preset and no flags', () => {
    expect(resolveExportSettings(undefined, {})).toEqual({
      format: 'csv',
      columns: DEFAULT_EXPORT_COLUMNS,
      header: true,
      quoteAll: false,
      dialect: 'ritual',
    })
  })

  test('a preset overrides the defaults', () => {
    expect(resolveExportSettings(preset, {})).toEqual({
      format: 'json',
      columns: ['name', 'listName'],
      header: false,
      quoteAll: true,
      dialect: 'ritual',
    })
  })

  test('explicit flags override the preset, including boolean negations', () => {
    expect(resolveExportSettings(preset, { format: 'csv', header: true, quoteAll: false })).toEqual(
      {
        format: 'csv',
        columns: ['name', 'listName'],
        header: true,
        quoteAll: false,
        dialect: 'ritual',
      },
    )
  })

  test('the dialect follows the same defaults → preset → flags precedence', () => {
    expect(resolveExportSettings({ ...preset, dialect: 'archidekt' }, {}).dialect).toBe('archidekt')
    expect(
      resolveExportSettings({ ...preset, dialect: 'archidekt' }, { dialect: 'ritual' }).dialect,
    ).toBe('ritual')
    expect(resolveExportSettings(undefined, { dialect: 'archidekt' }).dialect).toBe('archidekt')
  })

  test('a --no-header flag overrides a preset with header on', () => {
    const headerOn: ExportPreset = { format: 'csv', columns: ['name'], header: true }
    expect(resolveExportSettings(headerOn, { header: false }).header).toBe(false)
  })
})
